import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import {
  getLatestSnapshot,
  getRankMilestones,
  getRankSnapshots,
  insertRankSnapshot,
  type SnapshotInput
} from '../db/repositories/rankHistory.repo'
import { attributeInterval } from './rankAttribution'
import type { QueueType, RankHistory, RankRange } from '@shared/types'

const DAY_MS = 86_400_000

function windowStart(range: RankRange): number | null {
  if (range === 'all') return null
  return Date.now() - (range === '7d' ? 7 : 30) * DAY_MS
}

export function getRankHistory(
  accountId: number,
  queueType: QueueType,
  range: RankRange
): RankHistory {
  const db = getDb()
  const since = windowStart(range)

  return {
    snapshots: getRankSnapshots(db, accountId, queueType, since),
    milestones: getRankMilestones(db, accountId, queueType, since)
  }
}

/**
 * The single entry point for recording rank, used by both the LCU watcher and
 * the league-v4 backstop.
 *
 * Appends a snapshot when the value actually moved, then attributes that
 * movement to a game if it can be pinned to exactly one. Returns whether a
 * snapshot was written.
 */
export function recordRankSnapshot(
  accountId: number,
  input: SnapshotInput,
  source: 'lcu' | 'league_v4',
  capturedAt: number = Date.now()
): boolean {
  const db = getDb()
  const account = getAccountById(db, accountId)
  if (!account) return false

  const previous = getLatestSnapshot(db, accountId, input.queueType)
  const inserted = insertRankSnapshot(db, accountId, input, source, capturedAt)
  if (inserted === null) return false

  const current = getLatestSnapshot(db, accountId, input.queueType)
  if (previous && current) {
    attributeInterval(db, accountId, account.puuid, input.queueType, previous, current)
  }

  return true
}
