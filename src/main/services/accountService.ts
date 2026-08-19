import { getDb } from '../db'
import {
  deleteAccount,
  getAccountById,
  getAccountByPuuid,
  getAccountByRiotId as findStoredAccountByRiotId,
  getHomeAccount,
  getLeagueEntries,
  insertAccount,
  listAccounts,
  countAccounts,
  rekeyAccountPuuid,
  setHomeAccount,
  updateAccountProfile,
  upsertLeagueEntries
} from '../db/repositories/accounts.repo'
import { ensureSyncState, getSyncState } from '../db/repositories/syncState.repo'
import { recordRankSnapshot } from './rankHistoryService'
import { getAccountByRiotId } from '../riot/endpoints/account'
import { getSummonerByPuuid } from '../riot/endpoints/summoner'
import { getLeagueEntriesByPuuid } from '../riot/endpoints/league'
import { DEFAULT_PLATFORM, DEFAULT_REGIONAL_ROUTE, type PlatformId, type RegionalRoute } from '../riot/regions'
import type { Account, LeagueEntry, RiotIdInput, SyncState } from '@shared/types'

export const BACKFILL_TARGET = 200

export function getAccounts(): Account[] {
  return listAccounts(getDb())
}

export function getHome(): Account | null {
  return getHomeAccount(getDb())
}

/**
 * Resolves a Riot ID to a full account row (~3 API calls) and persists it.
 * Deliberately fast — the caller kicks off the long match backfill separately
 * so the UI can navigate to the new account immediately.
 */
export async function addAccount(input: RiotIdInput): Promise<Account> {
  const db = getDb()
  const platform: PlatformId = DEFAULT_PLATFORM
  const regional: RegionalRoute = DEFAULT_REGIONAL_ROUTE

  const riotAccount = await getAccountByRiotId(regional, input.gameName, input.tagLine)

  // Riot ID first, puuid second. After an API key change every stored puuid is
  // a value the new key cannot resolve, so dedupe on it alone would miss and
  // hand the user a second copy of an account they already track — with an
  // empty history, because the first copy still owns all of it.
  const existing =
    findStoredAccountByRiotId(db, riotAccount.gameName, riotAccount.tagLine) ??
    getAccountByPuuid(db, riotAccount.puuid)
  const summoner = await getSummonerByPuuid(platform, riotAccount.puuid)

  let accountId: number
  if (existing) {
    // Which makes re-adding an account the manual way to repair one, alongside
    // the automatic passes in identityService.
    if (existing.puuid !== riotAccount.puuid) {
      rekeyAccountPuuid(db, existing.id, existing.puuid, riotAccount.puuid)
    }
    updateAccountProfile(db, existing.id, {
      gameName: riotAccount.gameName,
      tagLine: riotAccount.tagLine,
      summonerId: summoner.id ?? null,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel
    })
    accountId = existing.id
  } else {
    accountId = insertAccount(db, {
      puuid: riotAccount.puuid,
      gameName: riotAccount.gameName,
      tagLine: riotAccount.tagLine,
      platform,
      regionalRoute: regional,
      summonerId: summoner.id ?? null,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel
    })
  }

  await refreshRank(accountId)
  ensureSyncState(db, accountId, BACKFILL_TARGET)

  // First account added becomes home so the app has somewhere to open to.
  if (countAccounts(db) === 1) setHomeAccount(db, accountId)

  return getAccountById(db, accountId)!
}

/**
 * Refreshes the current rank and records it in the history.
 *
 * `league_entries` only ever holds the latest value, so on its own every call
 * here destroyed the previous reading. Appending a snapshot alongside is the
 * backstop half of LP tracking: the LCU watcher catches individual games while
 * the app runs, and this catches whatever moved while it did not.
 */
export async function refreshRank(accountId: number): Promise<LeagueEntry[]> {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  const entries = await getLeagueEntriesByPuuid(account.platform as PlatformId, account.puuid)
  upsertLeagueEntries(db, accountId, entries)

  const stored = getLeagueEntries(db, accountId)
  for (const entry of stored) {
    recordRankSnapshot(
      accountId,
      {
        queueType: entry.queueType,
        tier: entry.tier,
        rank: entry.rank,
        leaguePoints: entry.leaguePoints,
        wins: entry.wins,
        losses: entry.losses
      },
      'league_v4'
    )
  }

  return stored
}

export function removeAccount(accountId: number): void {
  const db = getDb()
  const wasHome = getAccountById(db, accountId)?.isHomeAccount ?? false
  deleteAccount(db, accountId)

  // Promote another account so the app still has a landing page.
  if (wasHome) {
    const remaining = listAccounts(db)
    if (remaining.length > 0) setHomeAccount(db, remaining[0].id)
  }
}

export function setHome(accountId: number): void {
  setHomeAccount(getDb(), accountId)
}

export interface DashboardData {
  account: Account
  leagueEntries: LeagueEntry[]
  syncState: SyncState | null
}

export function getDashboard(accountId: number): DashboardData | null {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) return null
  return {
    account,
    leagueEntries: getLeagueEntries(db, accountId),
    syncState: getSyncState(db, accountId)
  }
}
