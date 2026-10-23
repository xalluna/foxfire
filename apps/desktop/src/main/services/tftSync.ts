import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { filterUnstoredMatchIds } from '../db/repositories/matches.repo'
import { ensureSyncState, markBackfillComplete, markDeltaSynced } from '../db/repositories/syncState.repo'
import { insertTftMatch } from '../db/repositories/tftMatches.repo'
import { hasTftApiKey, isNoProductAccess, isStaleIdentity } from '../riot/client'
import { getTftMatchById, getTftMatchIdsByPuuid, TFT_MATCH_IDS_PAGE_SIZE } from '../riot/endpoints/tftMatch'
import { RiotApiError } from '../riot/rateLimiter'
import type { RegionalRoute } from '../riot/regions'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { withSpan } from '../telemetry/spans'
import { BACKFILL_TARGET, refreshTftRank } from './accountService'
import { ATTRIBUTION_REPLAY_WINDOW_MS, replayAttribution } from './rankAttribution'
import { bindPendingRecordings } from './recordingService'
import { recordTftAccess, shouldTryTft } from './tftAccess'
import { forgetTftIdentity, resolveTftPuuid } from './tftIdentity'
import { selectNewMatchIds } from './syncPlanning'
import type { StoredAccount } from '../db/repositories/accounts.repo'
import type { SyncProgressEvent, SyncTrigger } from '@shared/types'

const log = createLogger('tftSync')

/*
 * One account's TFT, synced on this PC: the same shape as League's in
 * syncService.ts — a backfill to the target, then whatever is newer — on its own
 * sync state, and asked through whichever key TFT has.
 *
 * What is TFT's own: an account can be known to TFT by a different id (a TFT
 * key's), and the key can turn out not to reach TFT at all, which is not a
 * failure of the sync but a fact about the key — reported once, and asked
 * again after a while rather than on every sync.
 */

export interface TftSyncResult {
  stored: number
  failed: number
}

function emit(event: Omit<SyncProgressEvent, 'accountId' | 'game'> & { accountId: number }): void {
  broadcast(CH.sync.progress, { ...event, accountId: String(event.accountId), game: 'tft' })
}

/** Up to `target` ids, newest first, paging at TFT's 100-per-request maximum. */
async function fetchTftMatchIds(region: RegionalRoute, puuid: string, target: number): Promise<string[]> {
  const ids: string[] = []
  while (ids.length < target) {
    const count = Math.min(TFT_MATCH_IDS_PAGE_SIZE, target - ids.length)
    const page = await getTftMatchIdsByPuuid(region, puuid, ids.length, count)
    ids.push(...page)
    if (page.length < count) break
  }
  return ids
}

/**
 * The id list, with the id that fetched it.
 *
 * On a TFT key of its own, a 400 Riot blames on decryption is an id learnt
 * under a key this PC no longer holds: forgotten, learnt again, and asked once
 * more. On the main key it is League's repair to make, which the next League
 * sync does, so it is reported rather than repaired here.
 */
async function fetchIdsRepairingIdentity(
  account: StoredAccount,
  target: number
): Promise<{ matchIds: string[]; puuid: string }> {
  const db = getDb()
  const region = account.regionalRoute as RegionalRoute
  const puuid = await resolveTftPuuid(db, account)

  try {
    return { matchIds: await fetchTftMatchIds(region, puuid, target), puuid }
  } catch (err) {
    if (!isStaleIdentity(err) || !hasTftApiKey()) throw err

    log.info('Riot rejected the stored TFT id; learning it again', { accountId: account.id })
    forgetTftIdentity(db, account)
    const repaired = await resolveTftPuuid(db, account)
    return { matchIds: await fetchTftMatchIds(region, repaired, target), puuid: repaired }
  }
}

/** The run, without the in-flight guard syncService puts around it. */
export async function runTftSync(accountId: number, trigger: SyncTrigger): Promise<TftSyncResult> {
  return withSpan('sync.account', { accountId, game: 'tft' }, async () => {
    const db = getDb()
    const account = getAccountById(db, accountId)
    if (!account) throw new Error(`Unknown account ${accountId}`)

    // A key known not to reach TFT is not asked again on every sync — only
    // once it has had time to change its mind. See tftAccess.ts.
    if (!shouldTryTft()) {
      emit({ accountId, phase: 'complete', current: 0, total: 0, message: 'This Riot key cannot reach TFT', trigger })
      return { stored: 0, failed: 0 }
    }

    const region = account.regionalRoute as RegionalRoute
    const state = ensureSyncState(db, accountId, BACKFILL_TARGET, 'tft')
    const isBackfill = !state.backfillComplete
    const phase = isBackfill ? 'backfill' : 'delta'
    log.info('TFT sync started', { accountId, phase, trigger })

    emit({ accountId, phase, current: 0, total: 0, message: 'Fetching match list…', trigger })

    let fetched: { matchIds: string[]; puuid: string }
    try {
      fetched = await fetchIdsRepairingIdentity(account, isBackfill ? state.backfillTarget : TFT_MATCH_IDS_PAGE_SIZE)
      recordTftAccess('granted')
    } catch (err) {
      if (!isNoProductAccess(err)) throw err

      // The key was never granted TFT: nothing to fetch, and nothing wrong
      // with the account. Said once, in the log and on the sync.
      recordTftAccess('denied')
      log.warn('The Riot key TFT is asked through cannot reach TFT', { accountId })
      emit({ accountId, phase: 'complete', current: 0, total: 0, message: 'This Riot key cannot reach TFT', trigger })
      return { stored: 0, failed: 0 }
    }

    const { matchIds: allIds, puuid } = fetched
    const candidates = isBackfill ? allIds : selectNewMatchIds(allIds, state.mostRecentMatchId)
    const idsToFetch = filterUnstoredMatchIds(db, candidates)

    let failed = 0
    let current = 0
    for (const matchId of idsToFetch) {
      try {
        await withSpan('sync.match', { phase, game: 'tft' }, async () => {
          const { match, rawJson } = await getTftMatchById(region, matchId)
          insertTftMatch(db, match, rawJson)
        })
      } catch (err) {
        // A refused key fails every match after it; stop rather than report a
        // hollow success, as League's sync does.
        if (err instanceof RiotApiError && err.isKeyRejection) throw err
        failed += 1
        log.error('Failed to sync a TFT match', err, { accountId, phase })
      }
      current += 1
      emit({ accountId, phase, current, total: idsToFetch.length, trigger })
    }

    // After the games, so the readings they fall between are there to find
    // them; best-effort, since the games are stored either way.
    try {
      await refreshTftRank(accountId, puuid)
    } catch (err) {
      log.debug('TFT rank refresh failed after sync', { accountId, error: String(err) })
    }
    try {
      replayAttribution(db, accountId, puuid, Date.now() - ATTRIBUTION_REPLAY_WINDOW_MS, 'tft')
    } catch (err) {
      log.debug('TFT LP attribution replay failed', { accountId, error: String(err) })
    }
    // A TFT recording waiting for this game finds it now. Written off only by a
    // run that landed everything, as League's are.
    try {
      await bindPendingRecordings(String(accountId), { allowGiveUp: failed === 0 })
    } catch (err) {
      log.debug('Recording binding failed after TFT sync', { accountId, error: String(err) })
    }

    // Only advanced when everything landed, so the next run retries the gaps.
    if (failed === 0) {
      if (isBackfill) markBackfillComplete(db, accountId, allIds[0] ?? null, 'tft')
      else markDeltaSynced(db, accountId, allIds[0] ?? null, 'tft')
    }

    const stored = idsToFetch.length - failed
    log.info('TFT sync finished', { accountId, phase, stored, failed })

    emit({
      accountId,
      phase: 'complete',
      current: stored,
      total: idsToFetch.length,
      message: failed > 0 ? `${failed} game${failed === 1 ? '' : 's'} failed — retry to fill gaps` : undefined,
      trigger
    })

    return { stored, failed }
  })
}

/** The error event for a TFT run that threw, so the profile's bar stops. */
export function emitTftSyncError(accountId: number, err: unknown, trigger: SyncTrigger): void {
  emit({
    accountId,
    phase: 'error',
    current: 0,
    total: 0,
    message: err instanceof Error ? err.message : 'Sync failed',
    trigger
  })
}
