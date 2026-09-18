import { getDb } from '../db'
import { getAccountByRiotId } from '../db/repositories/accounts.repo'
import { recordRankSnapshot } from '../services/rankHistoryService'
import { refreshRank } from '../services/accountService'
import { schedulePostGameSync } from '../services/postGameSync'
import { authedRequest, isServerMode } from '../services/serverService'
import { startSync } from '../services/syncService'
import type { Account, QueueType } from '@shared/types'

/**
 * What the League client watcher does with what it sees, wherever the data lives.
 *
 * The watcher itself is entirely machine-local and stays that way: it reads
 * loopback, it decides when a reading has settled, and it knows when a game
 * ended. None of that changes with a server. What changes is where the answer
 * goes — into this machine's SQLite, or over HTTP to a community's server — and
 * that is the only part behind this interface.
 *
 * Kept as a seam rather than branched inside the watcher because the logic it
 * would be branching around is the subtle part: the settling window, the forced
 * reading for a game worth no LP, which ladder is waited on. A copy of any of
 * that would drift, and the drift would be a missing LP figure that nobody
 * could reproduce without playing a ranked game.
 */
export interface LcuReporting {
  /**
   * The account the running client is signed in to, or null if it is somebody
   * this install does not follow.
   *
   * Matched on Riot ID rather than on the client's own player id. The League
   * client reports the canonical account UUID while everything stored carries
   * Riot's per-key encrypted puuid, and the two never compare equal — which is
   * also why a server files accounts under the Riot ID.
   */
  findAccount(gameName: string, tagLine: string): Promise<Account | null>

  /**
   * Files a reading. Returns whether a row was actually written.
   *
   * `force` writes it even when the value has not moved, which is what lets a
   * ranked game worth no LP still close its interval. Only the watcher knows
   * when that is safe — see rankSettling — so the decision stays there and only
   * the write is here.
   */
  recordRank(accountId: string, reading: LcuRankReading, force: boolean): Promise<boolean>

  /** A game just finished. Whatever fetches it should start looking. */
  gameEnded(accountId: string): Promise<void>

  /**
   * Refreshes the account's current standing after a reading moved.
   *
   * Best-effort and never awaited for its result: the reading is already
   * recorded, and this only brings the profile card into line with it.
   */
  refreshStanding(accountId: string): Promise<void>
}

/** A reading as the League client reports it. */
export interface LcuRankReading {
  queueType: QueueType
  tier: string | null
  rank: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
}

const localReporting: LcuReporting = {
  findAccount: async (gameName, tagLine) => {
    const account = getAccountByRiotId(getDb(), gameName, tagLine)
    return account ? { ...account, id: String(account.id) } : null
  },

  recordRank: async (accountId, reading, force) =>
    recordRankSnapshot(Number(accountId), reading, 'lcu', Date.now(), force),

  gameEnded: async (accountId) => {
    schedulePostGameSync(Number(accountId))
  },

  refreshStanding: async (accountId) => {
    await refreshRank(Number(accountId))
  }
}

const serverReporting: LcuReporting = {
  findAccount: async (gameName, tagLine) => {
    // The server's list rather than a lookup endpoint: it is one request, it is
    // the same request the rest of the app already makes, and an install
    // follows a handful of accounts rather than thousands.
    const accounts = await authedRequest<Account[]>('/riot-accounts')
    const riotId = `${gameName}#${tagLine}`.toLowerCase()

    return (
      accounts.find((a) => `${a.gameName}#${a.tagLine}`.toLowerCase() === riotId) ?? null
    )
  },

  recordRank: async (accountId, reading, force) => {
    // The server says whether it filed the reading rather than leaving it to a
    // status code, because the watcher acts on the answer exactly as it does on
    // the local path's: a forced reading that was written is what clears its
    // wait for a post-game value to settle.
    const written = await authedRequest<{ recorded: boolean }>('/rank-readings', {
      method: 'POST',
      body: {
        riotAccountId: accountId,
        queueType: reading.queueType,
        tier: reading.tier,
        division: reading.rank,
        leaguePoints: reading.leaguePoints,
        wins: reading.wins,
        losses: reading.losses,
        force
      }
    })

    return written?.recorded ?? true
  },

  gameEnded: async (accountId) => {
    // The retry ladder belongs to the server: it has to keep running after this
    // laptop closes, and two people who were in the same game must not both
    // walk it.
    await authedRequest<void>('/sync/game-ended', {
      method: 'POST',
      body: { riotAccountId: accountId }
    })
  },

  refreshStanding: async () => {
    // Nothing to do. The server takes a reading from Riot at the end of every
    // sync it runs, and the sync it is about to run was just asked for — a
    // second request here would spend the community's budget on something it is
    // already about to fetch.
  }
}

/** Whichever store the watcher is reporting to right now. */
export function lcuReporting(): LcuReporting {
  return isServerMode() ? serverReporting : localReporting
}

/**
 * Starts a sync for an account, wherever the syncing happens.
 *
 * Used by the launch sweep, which runs before anything has reported anything
 * and simply wants each account brought up to date.
 */
export async function startSyncFor(accountId: string): Promise<void> {
  if (isServerMode()) {
    await authedRequest<void>(`/sync/${accountId}`, { method: 'POST' })
    return
  }

  startSync(Number(accountId), 'auto')
}
