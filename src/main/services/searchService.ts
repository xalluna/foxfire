import { getAccountByRiotId } from '../riot/endpoints/account'
import { getSummonerByPuuid } from '../riot/endpoints/summoner'
import { getLeagueEntriesByPuuid } from '../riot/endpoints/league'
import { getMatchById, getMatchIdsByPuuid } from '../riot/endpoints/match'
import { DEFAULT_PLATFORM, DEFAULT_REGIONAL_ROUTE } from '../riot/regions'
import type { AdHocSummonerResult, MatchSummary, QueueType, RiotIdInput } from '@shared/types'

const AD_HOC_MATCH_COUNT = 10

/**
 * Live lookup for summoners the user doesn't track. Deliberately writes
 * nothing to the database — no backfill, no cache table — so the only
 * persisted data belongs to accounts the user explicitly added.
 */
export async function searchSummoner(input: RiotIdInput): Promise<AdHocSummonerResult> {
  const platform = DEFAULT_PLATFORM
  const regional = DEFAULT_REGIONAL_ROUTE

  const account = await getAccountByRiotId(regional, input.gameName, input.tagLine)
  const [summoner, entries] = await Promise.all([
    getSummonerByPuuid(platform, account.puuid),
    getLeagueEntriesByPuuid(platform, account.puuid)
  ])

  const matchIds = await getMatchIdsByPuuid(regional, account.puuid, 0, AD_HOC_MATCH_COUNT)
  const matches = await Promise.all(matchIds.map((id) => getMatchById(regional, id)))

  const recentMatches: MatchSummary[] = matches.flatMap((match) => {
    const me = match.info.participants.find((p) => p.puuid === account.puuid)
    if (!me) return []
    return [
      {
        matchId: match.metadata.matchId,
        gameCreation: match.info.gameCreation,
        gameDuration: match.info.gameDuration,
        gameMode: match.info.gameMode,
        queueId: match.info.queueId,
        win: me.win,
        championId: me.championId,
        championName: me.championName,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists
      }
    ]
  })

  return {
    profile: {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel
    },
    leagueEntries: entries
      .filter((e) => e.queueType === 'RANKED_SOLO_5x5' || e.queueType === 'RANKED_FLEX_SR')
      .map((e) => ({
        queueType: e.queueType as QueueType,
        tier: e.tier ?? null,
        rank: e.rank ?? null,
        leaguePoints: e.leaguePoints ?? null,
        wins: e.wins ?? null,
        losses: e.losses ?? null,
        fetchedAt: new Date().toISOString()
      })),
    recentMatches
  }
}
