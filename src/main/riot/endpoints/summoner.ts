import { riotFetch } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { SummonerDtoSchema, type SummonerDto } from '../types'

export async function getSummonerByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<SummonerDto> {
  const path = `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
  const data = await riotFetch<unknown>(platformBaseUrl(platform), path)
  return SummonerDtoSchema.parse(data)
}
