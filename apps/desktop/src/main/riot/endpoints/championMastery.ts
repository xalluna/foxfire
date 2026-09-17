import { riotRequest } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { ChampionMasteryDtoSchema, type ChampionMasteryDto } from '../types'

export async function getChampionMasteryByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<ChampionMasteryDto[]> {
  const path = `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}`
  return riotRequest(
    '/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}',
    platformBaseUrl(platform),
    path,
    ChampionMasteryDtoSchema.array()
  )
}
