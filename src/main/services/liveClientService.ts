import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { isNotRunning, liveClientGet } from '../liveClient/client'
import { AllGameDataSchema } from '../liveClient/types'
import { toScoreboard } from '../liveClient/scoreboardMapping'
import { getAssetManifest } from './ddragonService'
import { getAccountByRiotId } from '../riot/endpoints/account'
import { getLeagueEntriesByPuuid } from '../riot/endpoints/league'
import { PLATFORM_TO_REGIONAL, type PlatformId } from '../riot/regions'
import type { LeagueEntryDto } from '../riot/types'
import type { LeagueEntry, QueueType, Scoreboard } from '@shared/types'
import { TRACKED_QUEUES } from '@shared/queues'

/**
 * Reads the scoreboard out of the game running on this machine.
 *
 * Returns null whenever there is no game — which is most of the time, and is
 * not a failure. Nothing listens on the port outside a match, so a refused
 * connection is the ordinary answer to "is a game on?" and the screen renders
 * it as an empty board rather than an error.
 *
 * Costs no Riot API calls at all: the game is the source, and the only thing
 * fetched alongside is the Data Dragon manifest, already cached for the life of
 * the process.
 */
export async function getScoreboard(accountId: number): Promise<Scoreboard | null> {
  const account = getAccountById(getDb(), accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  let raw: unknown
  try {
    raw = await liveClientGet('/liveclientdata/allgamedata')
  } catch (err) {
    if (isNotRunning(err)) return null
    throw err
  }

  const data = AllGameDataSchema.parse(raw)
  // Belt and braces. Probing a real game showed the port go from refused, to
  // 404 for about three seconds while the game process starts, straight to a
  // full ten-player roster during the loading screen — an empty allPlayers was
  // never actually observed. Kept anyway, because a board of nought rows is
  // not worth drawing whatever produces it.
  if (!data.allPlayers || data.allPlayers.length === 0) return null

  return toScoreboard(data, await getAssetManifest(), account)
}

/** Solo queue first, then any other ladder this app tracks. */
function soloEntry(entries: LeagueEntryDto[]): LeagueEntry | null {
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

/**
 * Resolves one row's rank, called once per row so the board fills in
 * progressively rather than waiting on ten lookups.
 *
 * Two calls rather than one: the game names players but does not identify them,
 * so the Riot ID has to be turned into a puuid before a ladder can be asked
 * about it. This is the only part of the scoreboard that touches the rate
 * limited API or needs a key at all — everything else still draws without one.
 */
export async function getRankByRiotId(
  platform: string,
  gameName: string,
  tagLine: string
): Promise<LeagueEntry | null> {
  const region = PLATFORM_TO_REGIONAL[platform as PlatformId]
  const account = await getAccountByRiotId(region, gameName, tagLine)
  return soloEntry(await getLeagueEntriesByPuuid(platform as PlatformId, account.puuid))
}
