import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { getChampionWinRates } from '../db/repositories/matches.repo'
import { getMastery, upsertMastery } from '../db/repositories/mastery.repo'
import { getChampionMasteryByPuuid } from '../riot/endpoints/championMastery'
import type { PlatformId } from '../riot/regions'
import type { MasteryEntry, WinRateEntry } from '@shared/types'

export interface MasteryData {
  riotMastery: MasteryEntry[]
  localWinRates: WinRateEntry[]
}

/**
 * Combines Riot's official mastery (one API call, cached in SQLite) with
 * win rates computed locally from already-synced matches — no extra calls.
 */
export async function getMasteryData(accountId: number, refresh: boolean): Promise<MasteryData> {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  let stored = getMastery(db, accountId)
  if (refresh || stored.length === 0) {
    const fresh = await getChampionMasteryByPuuid(account.platform as PlatformId, account.puuid)
    upsertMastery(db, accountId, fresh)
    stored = getMastery(db, accountId)
  }

  return {
    riotMastery: stored,
    localWinRates: getChampionWinRates(db, account.puuid)
  }
}
