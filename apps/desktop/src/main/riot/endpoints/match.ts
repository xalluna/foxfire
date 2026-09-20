import { riotRequest } from '../client'
import { regionalBaseUrl, type RegionalRoute } from '../regions'
import { MatchDtoSchema, MatchIdsResponseSchema, type MatchDto } from '../types'

export const MATCH_IDS_PAGE_SIZE = 100

export async function getMatchIdsByPuuid(
  region: RegionalRoute,
  puuid: string,
  start = 0,
  count = MATCH_IDS_PAGE_SIZE
): Promise<string[]> {
  const path = `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${count}`
  // Paging lives in the query string and is deliberately left out of the
  // template, so every page of a backfill groups under one endpoint.
  return riotRequest(
    '/lol/match/v5/matches/by-puuid/{puuid}/ids',
    regionalBaseUrl(region),
    path,
    MatchIdsResponseSchema
  )
}

export async function getMatchById(region: RegionalRoute, matchId: string): Promise<MatchDto> {
  const path = `/lol/match/v5/matches/${encodeURIComponent(matchId)}`
  return riotRequest(
    '/lol/match/v5/matches/{matchId}',
    regionalBaseUrl(region),
    path,
    MatchDtoSchema
  )
}
