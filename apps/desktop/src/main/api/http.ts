import { createServerData, type ServerMatchSummary } from '@foxfire/core/server'
import { getServerState, serverApi } from '../services/serverService'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import { getRecordingArtefactsForMatches } from '../db/repositories/recordings.repo'
import { getReplayIdsForMatches } from '../db/repositories/replays.repo'
import { accountContext } from './accountContext'
import type { ServerBackedApi } from './types'
import type { MatchSummary } from '@shared/types'

/**
 * Everything the renderer reads, answered by the Foxfire Server it has joined.
 *
 * The mirror image of local.ts, method for method, because both satisfy the
 * same contract: the renderer calls `window.api` and cannot tell which one
 * answered. The server half is @foxfire/core's, and it is the very same code
 * the web client reads through — what is here is what only this machine has.
 *
 * Two things, both about this machine.
 *
 * A match row can carry a recording and a replay, and no server can know
 * either: they are files on this disk. So the rows come back without them and
 * are joined against local SQLite on the way past. One query for the page
 * rather than one per row, since a page of history is twenty matches and
 * twenty round trips to the same table would be twenty for nothing.
 *
 * And a server id is not a thing the account list can invent. `accounts.add`
 * exists on this contract because local-only mode has it, but linking on a
 * server is LCU-attested — the desktop reports the Riot ID the League client
 * says is logged in, and the server resolves it. Typing a name into a box is
 * not attestation, so that path says so rather than half-working.
 */
const shared = createServerData(serverApi(), {
  get: () => getSetting(getDb(), homeSettingKey()),
  set: (accountId) => setSetting(getDb(), homeSettingKey(), accountId)
})

export const httpApi: ServerBackedApi = {
  ...shared,

  accounts: {
    ...shared.accounts,

    add: async (input) => {
      // Reported rather than attempted. On a server a link is attested by a
      // running League client, and the server resolves the Riot ID it reports;
      // a name typed into a box attests to nothing, and quietly creating an
      // unattested link would make the claim mean less for everybody.
      throw new Error(
        `Add ${input.gameName}#${input.tagLine} by signing in to it in the League client — `
          + 'a server links the account it can see is yours.'
      )
    },

    link: async (input) => {
      // The endpoint the whole LCU-attested design is built around, and which
      // nothing reached until now: add refuses a typed Riot ID on purpose, and
      // the watcher only ever looked accounts up. An account could be on a
      // server, be visible to everybody, carry its owner's history — and have
      // no way to become anybody's.
      const account = await serverApi().accounts.link(input)

      // Not awaited, exactly as the local path does not await its backfill.
      void serverApi().sync.start(account.id).catch(() => {
        // A claim that worked is worth reporting even if the sync that follows
        // did not start; the next launch sweep picks it up.
      })

      return account
    }
  },

  dashboard: {
    ...shared.dashboard,

    matchList: async (accountId, limit, offset, queueId) =>
      withLocalArtefacts(accountId, await shared.dashboard.matchList(accountId, limit, offset, queueId))
  },

  // The same routes the web client calls. Attaching from here, with the
  // markers this machine captured, goes through youtube/attach.ts instead;
  // this is the plain path, for a link with nothing on this disk behind it.
  matchRecordings: serverApi().matchRecordings
}

/**
 * Which account this machine opens on, for the server it is signed in to.
 *
 * Keyed by server URL so joining a second community does not move where the
 * first one opens.
 */
function homeSettingKey(): string {
  return `home_account:${getServerState().activeUrl ?? ''}`
}

/**
 * Fills in the two things a server cannot answer.
 *
 * A recording is footage of one person's screen and a replay is a .rofl in one
 * person's folder, and neither exists anywhere but here. Both are looked up in
 * one query for the whole page — a page is twenty matches, and forty round
 * trips to the same two tables would be forty for nothing.
 *
 * Recordings are scoped to the account and replays are not, which is the same
 * asymmetry local-only mode has: a game two members played together is one row
 * each and only one of them holds the footage, while a .rofl is one file per
 * game on this machine and serves whoever played it.
 */
async function withLocalArtefacts(
  accountId: string,
  rows: ServerMatchSummary[]
): Promise<MatchSummary[]> {
  if (rows.length === 0) return []

  const db = getDb()
  const matchIds = rows.map((row) => row.matchId)

  const recordings = getRecordingArtefactsForMatches(db, await accountContext(accountId), matchIds)
  const replays = getReplayIdsForMatches(db, matchIds)

  // The server's own `recording` — a video attached on the server for this
  // row's player — passes straight through; `local` is only what is here.
  return rows.map((row) => {
    const recording = recordings.get(row.matchId)
    return {
      ...row,
      local: {
        recordingId: recording?.recordingId ?? null,
        recordingVideoId: recording?.videoId ?? null,
        recordingUploadPending: recording?.uploadPending ?? false,
        replayId: replays.get(row.matchId) ?? null
      }
    }
  })
}
