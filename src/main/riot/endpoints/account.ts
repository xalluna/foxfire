import { riotFetch } from '../client'
import { regionalBaseUrl, type RegionalRoute } from '../regions'
import { AccountDtoSchema, type AccountDto } from '../types'

export async function getAccountByRiotId(
  region: RegionalRoute,
  gameName: string,
  tagLine: string
): Promise<AccountDto> {
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  const data = await riotFetch<unknown>(regionalBaseUrl(region), path)
  return AccountDtoSchema.parse(data)
}

export async function getAccountByPuuid(
  region: RegionalRoute,
  puuid: string
): Promise<AccountDto> {
  const path = `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
  const data = await riotFetch<unknown>(regionalBaseUrl(region), path)
  return AccountDtoSchema.parse(data)
}
