import { getDb } from '../db'
import { getAccountById, listAccounts } from '../db/repositories/accounts.repo'
import {
  deleteSupersededManualSnapshots,
  getHistorySpan,
  getLatestSnapshot,
  getRankMilestones,
  getRankSnapshots,
  insertRankSnapshot,
  type SnapshotInput
} from '../db/repositories/rankHistory.repo'
import { attributeInterval, replayAttribution } from './rankAttribution'
import { rebuildAttribution } from './manualRankService'
import { listSeasons } from '../db/repositories/seasons.repo'
import { queueIdForQueueType, rangeBounds, seasonsSpanning } from '@foxfire/core'
import { createLogger } from '../telemetry/logger'
import type { QueueType, RankHistory, RankRange, Season } from '@shared/types'

const log = createLogger('rank')

export function getRankHistory(
  accountId: number,
  queueType: QueueType,
  range: RankRange
): RankHistory {
  const db = getDb()
  const seasons = listSeasons(db)
  const { sinceMs, untilMs } = rangeBounds(range, seasons)

  return {
    snapshots: getRankSnapshots(db, accountId, queueType, sinceMs, untilMs, seasons),
    milestones: getRankMilestones(db, accountId, queueType, sinceMs, untilMs, seasons)
  }
}

/**
 * The seasons this account has history in, newest first.
 *
 * Drives the picker on the Rank and Champions screens, and its first entry is
 * what both default to — which is why an account that has not played since last
 * season keeps showing that one rather than opening on an empty January.
 *
 * An account with no history at all reports the season it is currently in, so
 * the picker is never empty. Seasons are returned whole rather than as ids so
 * the renderer can label them without a copy of the table.
 */
export function getRankPeriods(accountId: number): Season[] {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) return []

  const seasons = listSeasons(db)
  const span = getHistorySpan(db, accountId, account.puuid)
  if (!span) {
    const current = seasons[seasons.length - 1]
    return current ? [current] : []
  }

  return seasonsSpanning(seasons, span.oldestMs, span.newestMs)
}

/**
 * Repairs LP attribution for every account, once, at startup.
 *
 * Deliberately not folded into the launch sync. Attribution is pure local
 * SQLite, while a sync begins with a Riot call — and personal keys expire every
 * 24 hours, so gating the repair on the sync would mean the games already sat
 * in the database stayed blank precisely when the key needed replacing. This
 * needs no key and no network.
 *
 * Unbounded rather than the 30-day window a routine sync uses: it runs once per
 * launch, and the whole point is to reach history recorded before attribution
 * could keep up with it.
 */
export function repairAttribution(): void {
  const db = getDb()
  try {
    let attributed = 0
    for (const account of listAccounts(db)) {
      attributed += replayAttribution(db, account.id, account.puuid)
    }
    if (attributed > 0) log.info('Backfilled LP for games on startup', { attributed })
  } catch (err) {
    // Never worth failing a launch over — the next sync replays anyway.
    log.debug('Startup LP attribution repair failed', { error: String(err) })
  }
}

/**
 * The single entry point for recording rank, used by both the LCU watcher and
 * the league-v4 backstop.
 *
 * Appends a snapshot when the value actually moved, then attributes that
 * movement to a game if it can be pinned to exactly one. Returns whether a
 * snapshot was written.
 *
 * `force` writes the row even when the reading is unchanged — see
 * insertRankSnapshot for why a game that moved no LP still needs one.
 *
 * The inline attribution here is a fast path, not the guarantee: it only lands
 * when the match already happens to be stored. replayAttribution is what
 * actually closes the interval once the match arrives.
 *
 * A real reading also settles any hand-entered one it has now measured for the
 * user — see deleteSupersededManualSnapshots. That happens before the fast path
 * runs, so attribution never reads a snapshot that is about to disappear.
 */
export function recordRankSnapshot(
  accountId: number,
  input: SnapshotInput,
  source: 'lcu' | 'league_v4',
  capturedAt: number = Date.now(),
  force = false
): boolean {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) return false

  const previous = getLatestSnapshot(db, accountId, input.queueType)
  const inserted = insertRankSnapshot(db, accountId, input, source, capturedAt, force)
  if (inserted === null) return false

  const superseded = deleteSupersededManualSnapshots(
    db,
    accountId,
    account.puuid,
    input.queueType,
    queueIdForQueueType(input.queueType),
    capturedAt
  )
  if (superseded > 0) {
    // The LP those entries produced is now stale, and upsertMatchRank cannot
    // remove a row it no longer has grounds to write. Rebuild instead of
    // trusting the fast path below.
    log.info('Live rank reading replaced hand-entered LP', { accountId, superseded })
    rebuildAttribution(db, accountId, account.puuid, input.queueType)
    return true
  }

  const current = getLatestSnapshot(db, accountId, input.queueType)
  if (previous && current) {
    attributeInterval(
      db,
      accountId,
      account.puuid,
      input.queueType,
      previous,
      current,
      listSeasons(db)
    )
  }

  return true
}
