import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { filterUnstoredMatchIds, insertMatch } from '../db/repositories/matches.repo'
import {
  ensureSyncState,
  getSyncState,
  markBackfillComplete,
  markDeltaSynced
} from '../db/repositories/syncState.repo'
import { getMatchById, getMatchIdsByPuuid, MATCH_IDS_PAGE_SIZE } from '../riot/endpoints/match'
import { RiotApiError } from '../riot/rateLimiter'
import type { RegionalRoute } from '../riot/regions'
import { CH } from '../ipc/channels'
import { BACKFILL_TARGET, refreshRank } from './accountService'
import { selectNewMatchIds } from './syncPlanning'
import type { SyncProgressEvent, SyncState } from '@shared/types'

// Guards against a second sync starting for an account that's already syncing
// (e.g. the user clicking between tabs while a backfill runs).
const inFlight = new Set<number>()

/**
 * Records where the ladder stands at the end of a sync.
 *
 * Never fails the sync: the matches are already committed by this point, and a
 * rank call that 404s on an unranked account or trips the rate limiter should
 * not turn a successful import into an error.
 */
async function snapshotRank(accountId: number): Promise<void> {
  try {
    await refreshRank(accountId)
  } catch {
    // Rank is best-effort; the next sync will try again.
  }
}

export function isSyncing(accountId: number): boolean {
  return inFlight.has(accountId)
}

function emit(event: SyncProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.sync.progress, event)
  }
}

/** Collects up to `target` match IDs, paging at Riot's 100-per-request maximum. */
async function fetchMatchIds(
  region: RegionalRoute,
  puuid: string,
  target: number
): Promise<string[]> {
  const ids: string[] = []
  while (ids.length < target) {
    const remaining = target - ids.length
    const count = Math.min(MATCH_IDS_PAGE_SIZE, remaining)
    const page = await getMatchIdsByPuuid(region, puuid, ids.length, count)
    ids.push(...page)
    if (page.length < count) break // reached the end of this player's history
  }
  return ids
}

/**
 * Fetches match details one at a time through the shared rate limiter and
 * persists each immediately, so an interrupted run resumes where it left off
 * (already-stored IDs are skipped on the next pass).
 */
async function fetchAndStore(
  accountId: number,
  region: RegionalRoute,
  matchIds: string[],
  phase: 'backfill' | 'delta'
): Promise<{ failed: number }> {
  const db = getDb()
  const total = matchIds.length
  let current = 0
  let failed = 0

  for (const matchId of matchIds) {
    try {
      const match = await getMatchById(region, matchId)
      insertMatch(db, match)
    } catch (err) {
      // An expired/invalid key fails every remaining match, so stop rather than
      // grinding through the rest and reporting a hollow "success".
      if (err instanceof RiotApiError && (err.status === 401 || err.status === 403)) {
        throw err
      }
      // One bad match shouldn't abort an otherwise healthy run.
      failed += 1
      console.error(`Failed to sync match ${matchId}:`, err)
    }
    current += 1
    emit({ accountId, phase, current, total })
  }

  return { failed }
}

export async function syncAccount(accountId: number): Promise<void> {
  if (inFlight.has(accountId)) return
  inFlight.add(accountId)

  try {
    const db = getDb()
    const account = getAccountById(db, accountId)
    if (!account) throw new Error(`Unknown account ${accountId}`)

    const region = account.regionalRoute as RegionalRoute
    const state = ensureSyncState(db, accountId, BACKFILL_TARGET)
    const isBackfill = !state.backfillComplete
    const phase = isBackfill ? 'backfill' : 'delta'

    emit({ accountId, phase, current: 0, total: 0, message: 'Fetching match list…' })

    const target = isBackfill ? state.backfillTarget : MATCH_IDS_PAGE_SIZE
    const allIds = await fetchMatchIds(region, account.puuid, target)

    // Delta sync only needs matches newer than the last one we stored.
    const candidates = isBackfill ? allIds : selectNewMatchIds(allIds, state.mostRecentMatchId)
    const idsToFetch = filterUnstoredMatchIds(db, candidates)

    if (idsToFetch.length === 0) {
      if (isBackfill) markBackfillComplete(db, accountId, allIds[0] ?? null)
      else markDeltaSynced(db, accountId, allIds[0] ?? null)
      await snapshotRank(accountId)
      emit({ accountId, phase: 'complete', current: 0, total: 0 })
      return
    }

    const { failed } = await fetchAndStore(accountId, region, idsToFetch, phase)

    // Deliberately after the matches are stored: LP attribution looks for games
    // falling between two snapshots, so a snapshot taken first would find an
    // empty interval and leave the games that just arrived unattributed.
    await snapshotRank(accountId)

    // Only advance the sync marker when everything landed. Leaving it alone on
    // partial failure means the next run retries just the missing matches —
    // already-stored ones are filtered out, so the retry is cheap.
    if (failed === 0) {
      if (isBackfill) markBackfillComplete(db, accountId, allIds[0] ?? null)
      else markDeltaSynced(db, accountId, allIds[0] ?? null)
    }

    emit({
      accountId,
      phase: 'complete',
      current: idsToFetch.length - failed,
      total: idsToFetch.length,
      message: failed > 0 ? `${failed} match${failed === 1 ? '' : 'es'} failed — retry to fill gaps` : undefined
    })
  } catch (err) {
    emit({
      accountId,
      phase: 'error',
      current: 0,
      total: 0,
      message: err instanceof Error ? err.message : 'Sync failed'
    })
    throw err
  } finally {
    inFlight.delete(accountId)
  }
}

/** Fire-and-forget entry point for IPC — the renderer tracks progress via events. */
export function startSync(accountId: number): void {
  void syncAccount(accountId).catch((err) => {
    console.error(`Sync failed for account ${accountId}:`, err)
  })
}

export function readSyncState(accountId: number): SyncState | null {
  return getSyncState(getDb(), accountId)
}
