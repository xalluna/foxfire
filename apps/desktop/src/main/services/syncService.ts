import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { filterUnstoredMatchIds, insertMatch } from '../db/repositories/matches.repo'
import {
  ensureSyncState,
  getSyncState,
  markBackfillComplete,
  markDeltaSynced
} from '../db/repositories/syncState.repo'
import { isStaleIdentity } from '../riot/client'
import { getMatchById, getMatchIdsByPuuid, MATCH_IDS_PAGE_SIZE } from '../riot/endpoints/match'
import { RiotApiError } from '../riot/rateLimiter'
import type { RegionalRoute } from '../riot/regions'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { withSpan } from '../telemetry/spans'
import { BACKFILL_TARGET, refreshRank } from './accountService'
import { repairAccountIdentity } from './identityService'
import { ATTRIBUTION_REPLAY_WINDOW_MS, replayAttribution } from './rankAttribution'
import { resolveReplayOwners } from './replayService'
import { bindPendingRecordings } from './recordingService'
import { afterIdentityRepair, selectNewMatchIds } from './syncPlanning'
import type { StoredAccount } from '../db/repositories/accounts.repo'
import type { SyncProgressEvent, SyncState, SyncTrigger } from '@shared/types'

const log = createLogger('sync')

/**
 * Guards against a second sync starting for an account that's already syncing
 * (e.g. the user clicking between tabs while a backfill runs).
 *
 * Holds the running promise rather than just the id so a colliding caller joins
 * it instead of being dropped. Dropping silently was a real defect: the caller
 * got no progress events and no completion, so the renderer never invalidated
 * and the Sync now button read as dead. It also gives the post-game retry loop
 * an honest answer when it races the user pressing the button.
 */
const inFlight = new Map<number, Promise<SyncResult>>()

export interface SyncResult {
  /** Matches newly written to SQLite by this run. */
  stored: number
  failed: number
}

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
  } catch (err) {
    // Rank is best-effort; the next sync will try again. Logged rather than
    // truly silent, since a rank call failing every single sync is a real
    // problem that would otherwise never surface anywhere.
    log.debug('Rank snapshot failed after sync', { accountId, error: String(err) })
  }
}

/**
 * Closes any interval whose match has since arrived. Pure local SQLite, and
 * best-effort for the same reason as the rank snapshot above: the matches are
 * already committed, so a failure here must not fail the import.
 */
function replayRecentAttribution(db: DatabaseSync, accountId: number, puuid: string): void {
  try {
    const attributed = replayAttribution(
      db,
      accountId,
      puuid,
      Date.now() - ATTRIBUTION_REPLAY_WINDOW_MS
    )
    if (attributed > 0) log.debug('Attributed LP to games', { accountId, attributed })
  } catch (err) {
    log.debug('LP attribution replay failed', { accountId, error: String(err) })
  }
}

/**
 * Gives any finished recording the match it has been waiting for.
 *
 * Runs on every completed sync, not only on one that imported something. A sync
 * that stores nothing is exactly the shape of the run that follows an expired
 * key: the matches arrived on the sync before it, and this is the first pass
 * with a full library to search. Binding only on `stored > 0` left recordings
 * reading "Matching…" forever, because the moment that would have bound them
 * had already gone by.
 *
 * `cleanSweep` says whether the run landed everything it went looking for. Only
 * then may a recording be written off: a run that skipped a failed fetch may
 * have skipped precisely the match one was waiting for, and unmatched is not a
 * state to enter on a guess.
 *
 * Best-effort for the same reason as the two passes below — the matches are
 * already committed, so nothing here may fail the import.
 */
async function bindFinishedRecordings(accountId: number, cleanSweep: boolean): Promise<void> {
  try {
    await bindPendingRecordings(String(accountId), { allowGiveUp: cleanSweep })
  } catch (err) {
    log.debug('Recording binding failed after sync', { accountId, error: String(err) })
  }
}

/**
 * Gives newly synced matches to the replays that were waiting for them.
 *
 * A replay knows its match id from the moment the file lands, but only the
 * match says which account played it — so ownership is the one thing a replay
 * genuinely has to wait for a sync to learn. Cheap: it touches only rows still
 * missing an account, of which there are none once things have settled.
 *
 * Best-effort, like the passes around it. The matches are already committed and
 * nothing here may fail the import.
 */
function resolveFinishedReplays(): void {
  try {
    resolveReplayOwners()
  } catch (err) {
    log.debug('Replay owner resolution failed after sync', { error: String(err) })
  }
}

export function isSyncing(accountId: number): boolean {
  return inFlight.has(accountId)
}

/**
 * Carries the trigger on every event so the renderer can keep an automatic
 * post-game sync from flashing the progress bar while Riot catches up. Passed
 * down the call chain rather than held in module state, because two accounts
 * can sync concurrently and one's trigger must not leak into the other's
 * events.
 */
/**
 * Takes this machine's own id and publishes the renderer's.
 *
 * The conversion is here rather than at the five call sites because each of
 * those already spells the id the way the function around it does, and
 * stringifying at each would be five chances to forget.
 */
function emit(event: Omit<SyncProgressEvent, 'accountId'> & { accountId: number }): void {
  broadcast(CH.sync.progress, { ...event, accountId: String(event.accountId) })
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
 * The match list, together with the puuid that fetched it.
 *
 * A key rotation looks like exactly one thing from in here: Riot answers 400
 * for a puuid it cannot decrypt, because that puuid was encrypted under the key
 * this app used to hold. Nothing is wrong with the account and nothing is wrong
 * with the history — the identity has simply expired with the key — so the sync
 * re-resolves it from the Riot ID and asks again rather than failing in front
 * of the user with a bare 400.
 *
 * Once. A second failure is not the same failure, and a repair that reports
 * anything but a moved puuid says the retry would fail identically; both end
 * the run with something the user can act on. This is also the path that
 * repairs an install whose key was replaced before this code existed, since by
 * then the key is already saved and the settings hook has been and gone.
 *
 * Returns the puuid because the rest of the run needs the *current* one: LP
 * attribution reads it back out of the same rows this repair just rewrote.
 */
async function fetchMatchIdsRepairingIdentity(
  account: StoredAccount,
  target: number
): Promise<{ matchIds: string[]; puuid: string }> {
  const region = account.regionalRoute as RegionalRoute
  try {
    return { matchIds: await fetchMatchIds(region, account.puuid, target), puuid: account.puuid }
  } catch (err) {
    if (!isStaleIdentity(err)) throw err

    log.info('Riot rejected the stored puuid; re-resolving from the Riot ID', {
      accountId: account.id
    })
    const outcome = await repairAccountIdentity(account.id)
    const next = afterIdentityRepair(outcome, `${account.gameName}#${account.tagLine}`)
    if (!next.retry) throw new Error(next.message)

    const repaired = getAccountById(getDb(), account.id)!
    return { matchIds: await fetchMatchIds(region, repaired.puuid, target), puuid: repaired.puuid }
  }
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
  phase: 'backfill' | 'delta',
  trigger: SyncTrigger
): Promise<{ failed: number }> {
  const db = getDb()
  const total = matchIds.length
  let current = 0
  let failed = 0

  for (const matchId of matchIds) {
    try {
      // One span per match rather than separate spans for the fetch and the
      // write: the request already has its own row in riot_requests with the
      // queue-wait/network split, so all this needs to add is how long the
      // SQLite insert took alongside it.
      await withSpan('sync.match', { phase }, async () => {
        const match = await getMatchById(region, matchId)
        const insertStartedAt = Date.now()
        insertMatch(db, match)
        return Date.now() - insertStartedAt
      })
    } catch (err) {
      // An expired/invalid key fails every remaining match, so stop rather than
      // grinding through the rest and reporting a hollow "success".
      if (err instanceof RiotApiError && (err.status === 401 || err.status === 403)) {
        throw err
      }
      // One bad match shouldn't abort an otherwise healthy run.
      failed += 1
      log.error('Failed to sync match', err, { accountId, phase })
    }
    current += 1
    emit({ accountId, phase, current, total, trigger })
  }

  return { failed }
}

async function runGuarded(accountId: number, trigger: SyncTrigger): Promise<SyncResult> {
  try {
    // The root span. Everything below nests under it — including the Riot
    // requests, which pick the context up again across the rate limiter's
    // queue. A backfill is the only operation in the app long enough for
    // "where did the time go" to be a real question.
    return await withSpan('sync.account', { accountId }, () => runSync(accountId, trigger))
  } catch (err) {
    emit({
      accountId,
      phase: 'error',
      current: 0,
      total: 0,
      message: err instanceof Error ? err.message : 'Sync failed',
      trigger
    })
    throw err
  }
}

export function syncAccount(accountId: number, trigger: SyncTrigger = 'manual'): Promise<SyncResult> {
  // Join a run already under way rather than dropping this call. The joiner
  // gets that run's result, which is the honest answer to "did anything land" —
  // the matches it stored are stored either way.
  const running = inFlight.get(accountId)
  if (running) return running

  const run = runGuarded(accountId, trigger)
  inFlight.set(accountId, run)

  // Registered after the set, so the entry can never be cleared before it was
  // added. The swallowed rejection is only to keep this bookkeeping chain from
  // surfacing as an unhandled rejection — `run` itself still rejects for the
  // caller.
  void run.catch(() => {}).then(() => inFlight.delete(accountId))

  return run
}

/**
 * The sync itself, extracted so syncAccount is just the in-flight guard, the
 * root span and the error emit.
 */
async function runSync(accountId: number, trigger: SyncTrigger): Promise<SyncResult> {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  const region = account.regionalRoute as RegionalRoute
  const state = ensureSyncState(db, accountId, BACKFILL_TARGET)
  const isBackfill = !state.backfillComplete
  const phase = isBackfill ? 'backfill' : 'delta'
  log.info('Sync started', { accountId, phase, trigger })

  emit({ accountId, phase, current: 0, total: 0, message: 'Fetching match list…', trigger })

  const target = isBackfill ? state.backfillTarget : MATCH_IDS_PAGE_SIZE
  const { matchIds: allIds, puuid } = await fetchMatchIdsRepairingIdentity(account, target)

  // Delta sync only needs matches newer than the last one we stored.
  const candidates = isBackfill ? allIds : selectNewMatchIds(allIds, state.mostRecentMatchId)
  const idsToFetch = filterUnstoredMatchIds(db, candidates)

  if (idsToFetch.length === 0) {
    if (isBackfill) markBackfillComplete(db, accountId, allIds[0] ?? null)
    else markDeltaSynced(db, accountId, allIds[0] ?? null)
    await snapshotRank(accountId)
    // Still worth a pass even though nothing arrived: an interval left open by
    // an earlier run — a snapshot that landed before its match — closes here,
    // and so does a recording whose match was imported by an earlier sync that
    // never got to look for it.
    replayRecentAttribution(db, accountId, puuid)
    await bindFinishedRecordings(accountId, true)
    resolveFinishedReplays()
    emit({ accountId, phase: 'complete', current: 0, total: 0, trigger })
    return { stored: 0, failed: 0 }
  }

  const { failed } = await fetchAndStore(accountId, region, idsToFetch, phase, trigger)
  const stored = idsToFetch.length - failed

  // Deliberately after the matches are stored: LP attribution looks for games
  // falling between two snapshots, so a snapshot taken first would find an
  // empty interval and leave the games that just arrived unattributed.
  await snapshotRank(accountId)
  replayRecentAttribution(db, accountId, puuid)
  await bindFinishedRecordings(accountId, failed === 0)
  resolveFinishedReplays()

  // Only advance the sync marker when everything landed. Leaving it alone on
  // partial failure means the next run retries just the missing matches —
  // already-stored ones are filtered out, so the retry is cheap.
  if (failed === 0) {
    if (isBackfill) markBackfillComplete(db, accountId, allIds[0] ?? null)
    else markDeltaSynced(db, accountId, allIds[0] ?? null)
  }

  log.info('Sync finished', { accountId, phase, stored, failed })

  emit({
    accountId,
    phase: 'complete',
    current: stored,
    total: idsToFetch.length,
    message: failed > 0 ? `${failed} match${failed === 1 ? '' : 'es'} failed — retry to fill gaps` : undefined,
    trigger
  })

  return { stored, failed }
}

/** Fire-and-forget entry point for IPC — the renderer tracks progress via events. */
export function startSync(accountId: number, trigger: SyncTrigger = 'manual'): void {
  void syncAccount(accountId, trigger).catch((err) => {
    log.error('Sync failed', err, { accountId, trigger })
  })
}

export function readSyncState(accountId: number): SyncState | null {
  return getSyncState(getDb(), accountId)
}
