import { authedRequest, getServerState } from '../services/serverService'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import { getRecordingIdsForMatches } from '../db/repositories/recordings.repo'
import { getReplayIdsForMatches } from '../db/repositories/replays.repo'
import { accountContext } from './accountContext'
import type { ServerBackedApi } from './types'
import type { DashboardData, MasteryData } from '@shared/api'
import type {
  Account,
  AdHocSummonerResult,
  ChampionStats,
  EditableMatch,
  MatchDetail,
  MatchSummary,
  RankHistory,
  Season,
  SyncState
} from '@shared/types'

/**
 * Everything the renderer reads, answered by the Foxfire Server it has joined.
 *
 * The mirror image of local.ts, method for method, because both satisfy the
 * same contract: the renderer calls `window.api` and cannot tell which one
 * answered. That is the whole design, and it is why this file has almost no
 * decisions in it — the server made them, and the shapes it sends were chosen
 * to be the shapes already on the wire.
 *
 * Two things do happen here, and both are about this machine.
 *
 * A match row carries a recording id and a replay id, and no server can know
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
export const httpApi: ServerBackedApi = {
  accounts: {
    list: async () => withHome(await authedRequest<Account[]>('/riot-accounts')),

    getHome: async () => {
      const accounts = withHome(await authedRequest<Account[]>('/riot-accounts'))
      return accounts.find((a) => a.isHomeAccount) ?? null
    },

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

    remove: async (accountId) => {
      // Gives up the claim rather than deleting anything. On a shared server the
      // games are everybody's — the same match rows are on nine other people's
      // history — so removing an account returns it to unclaimed and leaves what
      // it played. An admin can take a claim away; nobody can take the history.
      await authedRequest<void>(`/riot-accounts/${accountId}`, { method: 'DELETE' })
      return withHome(await authedRequest<Account[]>('/riot-accounts'))
    },

    setHome: async (accountId) => {
      setSetting(getDb(), homeSettingKey(), accountId)
      return withHome(await authedRequest<Account[]>('/riot-accounts'))
    }
  },

  dashboard: {
    get: (accountId) => authedRequest<DashboardData | null>(`/riot-accounts/${accountId}/dashboard`),

    matchList: async (accountId, limit, offset, queueId) => {
      const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (queueId !== null) query.set('queueId', String(queueId))

      const rows = await authedRequest<ServerMatchSummary[]>(
        `/riot-accounts/${accountId}/matches?${query}`
      )

      return withLocalArtefacts(accountId, rows)
    },

    matchDetail: (matchId) =>
      authedRequest<MatchDetail | null>(`/matches/${encodeURIComponent(matchId)}`)
  },

  sync: {
    start: async (accountId) => {
      await authedRequest<void>(`/sync/${accountId}`, { method: 'POST' })
    },
    getState: (accountId) => authedRequest<SyncState | null>(`/sync/${accountId}`)
  },

  champions: {
    stats: (accountId, queueId, range) => {
      const query = new URLSearchParams({ range })
      if (queueId !== null) query.set('queueId', String(queueId))

      return authedRequest<ChampionStats[]>(`/riot-accounts/${accountId}/champions?${query}`)
    }
  },

  mastery: {
    get: (accountId, refresh, queueId) => {
      const query = new URLSearchParams({ refresh: String(refresh) })
      if (queueId !== null) query.set('queueId', String(queueId))

      return authedRequest<MasteryData>(`/riot-accounts/${accountId}/mastery?${query}`)
    }
  },

  rank: {
    history: (accountId, queueType, range) =>
      authedRequest<RankHistory>(
        `/riot-accounts/${accountId}/rank/history?queueType=${queueType}&range=${range}`
      ),

    periods: (accountId) => authedRequest<Season[]>(`/riot-accounts/${accountId}/rank/periods`),

    editable: (accountId, queueType) =>
      authedRequest<EditableMatch[]>(
        `/riot-accounts/${accountId}/rank/editable?queueType=${queueType}`
      ),

    // Both writers return the fresh list, as local.ts does, because an edit can
    // resolve a neighbouring game on its own. Neither broadcasts: a server's
    // writes arrive back over its own event stream, which is what the hub is
    // for, and telling the windows here as well would fire the refresh twice.
    saveManual: async (accountId, queueType, edits) => {
      await authedRequest<void>(`/riot-accounts/${accountId}/rank/manual`, {
        method: 'POST',
        body: { queueType, edits }
      })

      return authedRequest<EditableMatch[]>(
        `/riot-accounts/${accountId}/rank/editable?queueType=${queueType}`
      )
    },

    clearManual: async (accountId, queueType, matchId) => {
      await authedRequest<void>(
        `/riot-accounts/${accountId}/rank/manual/${encodeURIComponent(matchId)}`,
        { method: 'DELETE' }
      )

      return authedRequest<EditableMatch[]>(
        `/riot-accounts/${accountId}/rank/editable?queueType=${queueType}`
      )
    }
  },

  seasons: {
    list: () => authedRequest<Season[]>('/seasons'),
    save: async (seasons) => {
      await authedRequest<void>('/seasons', { method: 'PUT', body: seasons })
      return authedRequest<Season[]>('/seasons')
    }
  },

  search: {
    summoner: (input) =>
      authedRequest<AdHocSummonerResult>(
        `/search?gameName=${encodeURIComponent(input.gameName)}`
          + `&tagLine=${encodeURIComponent(input.tagLine)}`
      )
  }
}

/**
 * Which account this machine opens on, for the server it is signed in to.
 *
 * A server does not answer this and should not: it is a preference belonging to
 * one PC, and a server that held it would be holding one answer for everybody
 * signed in to it. Keyed by server URL so joining a second community does not
 * move where the first one opens.
 */
function homeSettingKey(): string {
  return `home_account:${getServerState().activeUrl ?? ''}`
}

/**
 * Stamps the local home preference onto the server's list.
 *
 * Falls back to the first account the caller owns, so a freshly joined server
 * opens somewhere rather than nowhere, and to the first account at all when
 * they have claimed none — on a shared server there is always somebody's
 * history to look at.
 */
function withHome(accounts: Account[]): Account[] {
  if (accounts.length === 0) return accounts

  const stored = getSetting(getDb(), homeSettingKey())
  const home =
    accounts.find((a) => a.id === stored) ?? accounts.find((a) => a.isMine) ?? accounts[0]

  return accounts.map((account) => ({ ...account, isHomeAccount: account.id === home.id }))
}

/** A match row as the server sends it: everything except what is on this disk. */
type ServerMatchSummary = Omit<MatchSummary, 'recordingId' | 'replayId'>

/**
 * Fills in the two fields a server cannot answer.
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

  const recordings = getRecordingIdsForMatches(db, await accountContext(accountId), matchIds)
  const replays = getReplayIdsForMatches(db, matchIds)

  return rows.map((row) => ({
    ...row,
    recordingId: recordings.get(row.matchId) ?? null,
    replayId: replays.get(row.matchId) ?? null
  }))
}
