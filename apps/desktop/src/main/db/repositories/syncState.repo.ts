import type { DatabaseSync } from 'node:sqlite'
import type { SyncState } from '@shared/types'

interface SyncStateRow {
  account_id: number
  most_recent_match_id: string | null
  backfill_complete: number
  backfill_target: number
  last_full_sync_at: string | null
  last_delta_sync_at: string | null
}

function toSyncState(row: SyncStateRow): SyncState {
  return {
    accountId: String(row.account_id),
    mostRecentMatchId: row.most_recent_match_id,
    backfillComplete: row.backfill_complete === 1,
    backfillTarget: row.backfill_target,
    lastFullSyncAt: row.last_full_sync_at,
    lastDeltaSyncAt: row.last_delta_sync_at
  }
}

export function ensureSyncState(
  db: DatabaseSync,
  accountId: number,
  backfillTarget: number
): SyncState {
  db.prepare(
    'INSERT OR IGNORE INTO sync_state (account_id, backfill_target) VALUES (?, ?)'
  ).run(accountId, backfillTarget)
  return getSyncState(db, accountId)!
}

export function getSyncState(db: DatabaseSync, accountId: number): SyncState | null {
  const row = db.prepare('SELECT * FROM sync_state WHERE account_id = ?').get(accountId) as
    | unknown as SyncStateRow
    | undefined
  return row ? toSyncState(row) : null
}

export function markBackfillComplete(
  db: DatabaseSync,
  accountId: number,
  mostRecentMatchId: string | null
): void {
  db.prepare(
    `UPDATE sync_state
        SET backfill_complete = 1, most_recent_match_id = ?, last_full_sync_at = datetime('now')
      WHERE account_id = ?`
  ).run(mostRecentMatchId, accountId)
}

export function markDeltaSynced(
  db: DatabaseSync,
  accountId: number,
  mostRecentMatchId: string | null
): void {
  db.prepare(
    `UPDATE sync_state
        SET most_recent_match_id = COALESCE(?, most_recent_match_id),
            last_delta_sync_at = datetime('now')
      WHERE account_id = ?`
  ).run(mostRecentMatchId, accountId)
}
