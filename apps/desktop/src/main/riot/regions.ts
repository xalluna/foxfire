// Riot splits endpoints across two routing schemes. Platform routing serves
// per-server data (summoner, league, spectator); regional routing serves
// data that's the same account-wide (account lookup, match history). This
// table is data-driven rather than hardcoded to NA so adding a region later
// is a config change, not a rewrite.
export type PlatformId = 'na1' | 'euw1' | 'eun1' | 'kr' | 'jp1' | 'oc1' | 'br1' | 'la1' | 'la2' | 'tr1' | 'ru'
export type RegionalRoute = 'americas' | 'europe' | 'asia' | 'sea'

export const PLATFORM_TO_REGIONAL: Record<PlatformId, RegionalRoute> = {
  na1: 'americas',
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  euw1: 'europe',
  eun1: 'europe',
  tr1: 'europe',
  ru: 'europe',
  kr: 'asia',
  jp1: 'asia',
  oc1: 'sea'
}

// v1 is NA-only; this is the sole default used by account creation/search.
export const DEFAULT_PLATFORM: PlatformId = 'na1'
export const DEFAULT_REGIONAL_ROUTE: RegionalRoute = PLATFORM_TO_REGIONAL[DEFAULT_PLATFORM]

export function platformBaseUrl(platform: PlatformId): string {
  return `https://${platform}.api.riotgames.com`
}

export function regionalBaseUrl(region: RegionalRoute): string {
  return `https://${region}.api.riotgames.com`
}
