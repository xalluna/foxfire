import { isNotFound, riotFetch } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'
import { ActiveGameDtoSchema, type ActiveGameDto } from '../types'

/** Returns null when the player isn't currently in a game (Riot answers 404 for that case). */
export async function getActiveGameByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<ActiveGameDto | null> {
  const path = `/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`
  try {
    const data = await riotFetch<unknown>(platformBaseUrl(platform), path)
    return ActiveGameDtoSchema.parse(data)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}
