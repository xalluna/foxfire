import { getDb } from '../db'
import { getAccountById, getLeagueEntries, listAccounts } from '../db/repositories/accounts.repo'
import { listSeasons } from '../db/repositories/seasons.repo'
import { getSyncState } from '../db/repositories/syncState.repo'
import { getTftFinishes } from '../db/repositories/tftMatches.repo'
import { laddersOf, seasonAt, seasonBoundsOf, tftLadderSummary, type TftLadder } from '@foxfire/core'
import type { LeagueEntry, SyncState, TftAccess, TftLadderSummary } from '@foxfire/core'
import type { StoredAccount } from '../db/repositories/accounts.repo'
import { tftAccess } from './tftAccess'
import { tftPuuidOf } from './tftIdentity'

/**
 * An account's TFT page, as this machine assembles it: TFT's ladders, its own
 * sync state, and each ladder's card counted over the current set — the same
 * shape a server answers, with an integer id inside. src/main/api/local.ts
 * converts it.
 */
export interface StoredTftDashboard {
  account: StoredAccount
  leagueEntries: LeagueEntry[]
  syncState: SyncState | null
  ladders: TftLadderSummary[]
  seasonLabel: string | null
  tftAccess: TftAccess
}

export function getTftDashboard(accountId: number, now = Date.now()): StoredTftDashboard | null {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) return null

  // The current set's games, which is what a card's spread is of.
  const seasons = listSeasons(db, 'tft')
  const current = seasonAt(seasons, now)
  const bounds = current ? seasonBoundsOf(seasons, current.id) : null
  const finishes = getTftFinishes(db, tftPuuidOf(db, account), bounds?.startMs ?? null, bounds?.endMs ?? null)

  return {
    account,
    leagueEntries: getLeagueEntries(db, accountId, 'tft'),
    syncState: getSyncState(db, accountId, 'tft'),
    ladders: (laddersOf('tft') as TftLadder[]).map((ladder) => tftLadderSummary(ladder, finishes)),
    seasonLabel: current?.label ?? null,
    tftAccess: tftAccess()
  }
}

/** Every account here by the id TFT files its boards under, for picking them out of a lobby. */
export function accountsByTftPuuid(): Map<string, number> {
  const db = getDb()
  return new Map(listAccounts(db).map((account) => [tftPuuidOf(db, account), account.id]))
}
