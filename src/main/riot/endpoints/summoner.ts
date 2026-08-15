import { riotRequest } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { SummonerDtoSchema, type SummonerDto } from '../types'

export async function getSummonerByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<SummonerDto> {
  const path = `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
  return riotRequest(
    '/lol/summoner/v4/summoners/by-puuid/{puuid}',
    platformBaseUrl(platform),
    path,
    SummonerDtoSchema
  )
}
