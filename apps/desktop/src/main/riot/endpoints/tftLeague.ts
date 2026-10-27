import { tftRequest } from '../client'
import { platformBaseUrl, regionalBaseUrl, type PlatformId, type RegionalRoute } from '../regions'
import { AccountDtoSchema, TftLeagueEntryDtoSchema, type AccountDto, type TftLeagueEntryDto } from '../types'

/** Every TFT ladder an account is on: Ranked, Double Up, and Hyper Roll's rating. */
export async function getTftLeagueEntriesByPuuid(
  platform: PlatformId,
  puuid: string
): Promise<TftLeagueEntryDto[]> {
  const path = `/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`
  return tftRequest(
    '/tft/league/v1/by-puuid/{puuid}',
    platformBaseUrl(platform),
    path,
    TftLeagueEntryDtoSchema.array()
  )
}

/**
 * An account as TFT's key knows it.
 *
 * With a TFT key of its own, Riot hands that key a different puuid for the same
 * player, and TFT's endpoints only accept that one. The account lookup is the
 * one call every key may make, so it is how the TFT id is learnt. Without a
 * TFT key this asks the main key, and answers the puuid the account already has.
 */
export async function getTftAccountByRiotId(
  region: RegionalRoute,
  gameName: string,
  tagLine: string
): Promise<AccountDto> {
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  return tftRequest(
    '/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}',
    regionalBaseUrl(region),
    path,
    AccountDtoSchema
  )
}
