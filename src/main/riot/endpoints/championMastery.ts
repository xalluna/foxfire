import { riotFetch } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { ChampionMasteryDtoSchema, type ChampionMasteryDto } from '../types'

export async function getChampionMasteryByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<ChampionMasteryDto[]> {
  const path = `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}`
  const data = await riotFetch<unknown>(platformBaseUrl(platform), path)
  return ChampionMasteryDtoSchema.array().parse(data)
}
