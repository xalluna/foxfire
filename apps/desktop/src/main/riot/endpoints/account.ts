import { riotRequest } from '../client'
import { regionalBaseUrl, type RegionalRoute } from '../regions'
import { AccountDtoSchema, type AccountDto } from '../types'

export async function getAccountByRiotId(
  region: RegionalRoute,
  gameName: string,
  tagLine: string
): Promise<AccountDto> {
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  return riotRequest(
    '/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}',
    regionalBaseUrl(region),
    path,
    AccountDtoSchema
  )
}
