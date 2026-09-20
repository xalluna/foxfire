import { riotRequest } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { LeagueEntryDtoSchema, type LeagueEntryDto } from '../types'

// Riot removed the by-summoner (encryptedSummonerId) variant of this endpoint;
// by-puuid is the supported path.
export async function getLeagueEntriesByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<LeagueEntryDto[]> {
  const path = `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
  return riotRequest(
    '/lol/league/v4/entries/by-puuid/{puuid}',
    platformBaseUrl(platform),
    path,
    LeagueEntryDtoSchema.array()
  )
}
