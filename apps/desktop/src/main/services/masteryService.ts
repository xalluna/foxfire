import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { getChampionStats } from '../db/repositories/matches.repo'
import { getMastery, upsertMastery } from '../db/repositories/mastery.repo'
import { getChampionMasteryByPuuid } from '../riot/endpoints/championMastery'
import type { PlatformId } from '../riot/regions'
import type { ChampionStats, MasteryEntry } from '@shared/types'

export interface MasteryData {
  riotMastery: MasteryEntry[]
  localWinRates: ChampionStats[]
}

/**
 * Combines Riot's official mastery (one API call, cached in SQLite) with
 * win rates computed locally from already-synced matches — no extra calls.
 *
 * Only the win rates respond to `queueId`. Riot's champion mastery is a single
 * lifetime figure with no per-queue breakdown, so it stays whole under any
 * filter and the UI labels it as such rather than implying it narrowed too.
 */
export async function getMasteryData(
  accountId: number,
  refresh: boolean,
  queueId: number | null = null
): Promise<MasteryData> {
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
    localWinRates: getChampionStats(db, account.puuid, queueId)
  }
}
