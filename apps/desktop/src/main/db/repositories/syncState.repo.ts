import type { DatabaseSync } from 'node:sqlite'
import type { GameId } from '@foxfire/core'
import type { SyncState } from '@shared/types'

/*
 * Sync state is per account and per game: League's backfill and TFT's run on
 * their own, each with its own newest game and its own times. Every function
 * here is League's unless it is told otherwise, which is what every caller
 * from before TFT meant.
 */

interface SyncStateRow {
  account_id: number
  game: string
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
    lastDeltaSyncAt: row.last_delta_sync_at,
    // No cooldown on this PC: its own key, its own budget.
    cooldownUntil: null,
    // Said only for TFT, as a server says it: League's state reads as it always did.
    ...(row.game === 'tft' ? { game: 'tft' as const } : {})
  }
}

export function ensureSyncState(
  db: DatabaseSync,
  accountId: number,
  backfillTarget: number,
  game: GameId = 'lol'
): SyncState {
  db.prepare(
    'INSERT OR IGNORE INTO sync_state (account_id, game, backfill_target) VALUES (?, ?, ?)'
  ).run(accountId, game, backfillTarget)
  return getSyncState(db, accountId, game)!
}

export function getSyncState(db: DatabaseSync, accountId: number, game: GameId = 'lol'): SyncState | null {
  const row = db.prepare('SELECT * FROM sync_state WHERE account_id = ? AND game = ?').get(accountId, game) as
    | unknown as SyncStateRow
    | undefined
  return row ? toSyncState(row) : null
}

export function markBackfillComplete(
  db: DatabaseSync,
  accountId: number,
  mostRecentMatchId: string | null,
  game: GameId = 'lol'
): void {
  db.prepare(
    `UPDATE sync_state
        SET backfill_complete = 1, most_recent_match_id = ?, last_full_sync_at = datetime('now')
      WHERE account_id = ? AND game = ?`
  ).run(mostRecentMatchId, accountId, game)
}

export function markDeltaSynced(
  db: DatabaseSync,
  accountId: number,
  mostRecentMatchId: string | null,
  game: GameId = 'lol'
): void {
  db.prepare(
    `UPDATE sync_state
        SET most_recent_match_id = COALESCE(?, most_recent_match_id),
            last_delta_sync_at = datetime('now')
      WHERE account_id = ? AND game = ?`
  ).run(mostRecentMatchId, accountId, game)
}
