import { riotFetch } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { LeagueEntryDtoSchema, type LeagueEntryDto } from '../types'

// Riot removed the by-summoner (encryptedSummonerId) variant of this endpoint;
// by-puuid is the supported path.
export async function getLeagueEntriesByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<LeagueEntryDto[]> {
  const path = `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
  const data = await riotFetch<unknown>(platformBaseUrl(platform), path)
  return LeagueEntryDtoSchema.array().parse(data)
}
