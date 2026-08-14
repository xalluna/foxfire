import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { getActiveGameByPuuid } from '../riot/endpoints/spectator'
import { getLeagueEntriesByPuuid } from '../riot/endpoints/league'
import { getAccountByPuuid } from '../riot/endpoints/account'
import type { PlatformId, RegionalRoute } from '../riot/regions'
import type { LeagueEntry, LiveGameData, LiveGameParticipant, QueueType } from '@shared/types'

/** Riot's spectator payload carries "gameName#tagLine" as a single string on newer responses. */
function splitRiotId(riotId: string | undefined): { gameName: string | null; tagLine: string | null } {
  if (!riotId) return { gameName: null, tagLine: null }
  const idx = riotId.lastIndexOf('#')
  if (idx === -1) return { gameName: riotId, tagLine: null }
  return { gameName: riotId.slice(0, idx), tagLine: riotId.slice(idx + 1) }
}

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

  const participants: LiveGameParticipant[] = game.participants.map((p) => {
    const { gameName, tagLine } = splitRiotId(p.riotId)
    return {
      puuid: p.puuid,
      gameName,
      tagLine,
      teamId: p.teamId,
      championId: p.championId,
      spell1Id: p.spell1Id,
      spell2Id: p.spell2Id,
      rank: null,
      rankLoading: true
    }
  })

  return {
    gameId: game.gameId,
    gameMode: game.gameMode,
    gameLength: game.gameLength,
    participants
  }
}

const TRACKED_QUEUES: QueueType[] = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']

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

/** Fills in a display name for participants whose spectator payload lacked a riotId. */
export async function resolveParticipantName(
  regionalRoute: string,
  puuid: string
): Promise<{ gameName: string; tagLine: string } | null> {
  try {
    const acct = await getAccountByPuuid(regionalRoute as RegionalRoute, puuid)
    return { gameName: acct.gameName, tagLine: acct.tagLine }
  } catch {
    return null
  }
}
