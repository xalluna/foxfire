import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { getActiveGameByPuuid } from '../riot/endpoints/spectator'
import { getLeagueEntriesByPuuid } from '../riot/endpoints/league'
import { toLiveGameParticipants } from './liveGameMapping'
import type { PlatformId } from '../riot/regions'
import type { LeagueEntry, LiveGameData, QueueType } from '@shared/types'
import { TRACKED_QUEUES } from '@shared/queues'

/**
 * Manual check only — no background polling. Returns null when the player
 * isn't in a game. Ranks are deliberately omitted here and fetched per-row by
 * the renderer so the roster paints immediately.
 */
export async function checkLiveGame(accountId: number): Promise<LiveGameData | null> {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  const game = await getActiveGameByPuuid(account.platform as PlatformId, account.puuid)
  if (!game) return null

  return {
    gameId: game.gameId,
    gameMode: game.gameMode,
    gameLength: game.gameLength,
    participants: toLiveGameParticipants(game, account)
  }
}

/** Resolves one participant's solo-queue rank; called once per row so the UI fills in progressively. */
export async function getParticipantRank(
  platform: string,
  puuid: string
): Promise<LeagueEntry | null> {
  const entries = await getLeagueEntriesByPuuid(platform as PlatformId, puuid)
  const solo =
    entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ??
    entries.find((e) => TRACKED_QUEUES.includes(e.queueType as QueueType))
  if (!solo) return null

  return {
    queueType: solo.queueType as QueueType,
    tier: solo.tier ?? null,
    rank: solo.rank ?? null,
    leaguePoints: solo.leaguePoints ?? null,
    wins: solo.wins ?? null,
    losses: solo.losses ?? null,
    fetchedAt: new Date().toISOString()
  }
}
