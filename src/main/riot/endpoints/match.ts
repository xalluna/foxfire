import { riotFetch } from '../client'
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
  const data = await riotFetch<unknown>(regionalBaseUrl(region), path)
  return MatchIdsResponseSchema.parse(data)
}

export async function getMatchById(region: RegionalRoute, matchId: string): Promise<MatchDto> {
  const path = `/lol/match/v5/matches/${encodeURIComponent(matchId)}`
  const data = await riotFetch<unknown>(regionalBaseUrl(region), path)
  return MatchDtoSchema.parse(data)
}
