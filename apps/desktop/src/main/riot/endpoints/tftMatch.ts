import { tftRequest } from '../client'
import { regionalBaseUrl, type RegionalRoute } from '../regions'
import { MatchIdsResponseSchema, TftMatchDtoSchema, type TftMatchDto } from '../types'

/** The most ids TFT's match list answers in one page. */
export const TFT_MATCH_IDS_PAGE_SIZE = 100

export async function getTftMatchIdsByPuuid(
  region: RegionalRoute,
  puuid: string,
  start = 0,
  count = TFT_MATCH_IDS_PAGE_SIZE
): Promise<string[]> {
  const path = `/tft/match/v1/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${count}`
  // Paging lives in the query string and is left out of the template, so every
  // page of a backfill groups under one endpoint, as League's does.
  return tftRequest(
    '/tft/match/v1/matches/by-puuid/{puuid}/ids',
    regionalBaseUrl(region),
    path,
    MatchIdsResponseSchema
  )
}

/** A TFT game, and the payload exactly as Riot sent it, which is what is stored. */
export interface RawTftMatch {
  match: TftMatchDto
  rawJson: string
}

/**
 * One TFT game.
 *
 * The raw text is kept beside the parsed shape because the schema fills in
 * defaults and the stored payload should be Riot's, not this app's reading of
 * it — the importer sends it on to a server that parses it again.
 */
export async function getTftMatchById(region: RegionalRoute, matchId: string): Promise<RawTftMatch> {
  const path = `/tft/match/v1/matches/${encodeURIComponent(matchId)}`
  return tftRequest('/tft/match/v1/matches/{matchId}', regionalBaseUrl(region), path, {
    parse: (data: unknown): RawTftMatch => ({ match: TftMatchDtoSchema.parse(data), rawJson: JSON.stringify(data) })
  })
}
