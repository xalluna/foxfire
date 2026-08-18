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

  // Mirrors the shape getMatchSummaries returns from SQLite, so ad-hoc results
  // render through exactly the same match row as tracked accounts.
  const recentMatches: MatchSummary[] = matches.flatMap((match) => {
    const me = match.info.participants.find((p) => p.puuid === account.puuid)
    if (!me) return []

    const team = match.info.participants.filter((p) => p.teamId === me.teamId)

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
        champLevel: me.champLevel,
        kills: me.kills,
        deaths: me.deaths,
        assists: me.assists,
        cs: me.totalMinionsKilled + me.neutralMinionsKilled,
        goldEarned: me.goldEarned,
        damageDealtToChampions: me.totalDamageDealtToChampions,
        largestMultiKill: me.largestMultiKill ?? null,
        items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5, me.item6],
        roleBoundItem: me.roleBoundItem ?? 0,
        summoner1Id: me.summoner1Id,
        summoner2Id: me.summoner2Id,
        perks: me.perks,
        teamPosition: me.teamPosition ?? null,
        teamKills: team.reduce((sum, p) => sum + p.kills, 0),
        teamDamage: team.reduce((sum, p) => sum + p.totalDamageDealtToChampions, 0),
        isRemake: me.gameEndedInEarlySurrender === true,
        // LP history is only ever derived for tracked accounts, and search
        // deliberately persists nothing — so an ad-hoc lookup never has one,
        // and there is nothing for the LP editor to act on either.
        rank: null,
        hasManualRank: false,
        // Ad-hoc results are somebody else's games played on another machine.
        replayId: null
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
