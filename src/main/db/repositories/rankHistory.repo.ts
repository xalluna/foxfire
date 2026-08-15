import type { DatabaseSync } from 'node:sqlite'
import type { QueueType, RankMilestone, RankSnapshot } from '@shared/types'
import { ladderPosition, rankMovement } from '@shared/ladder'

interface SnapshotRow {
  queue_type: string
  tier: string | null
  rank: string | null
  league_points: number | null
  wins: number | null
  losses: number | null
  ladder_position: number | null
  source: string
  captured_at: number
}

function toSnapshot(row: SnapshotRow): RankSnapshot {
  return {
    queueType: row.queue_type as QueueType,
    tier: row.tier,
    rank: row.rank,
    leaguePoints: row.league_points,
    wins: row.wins,
    losses: row.losses,
    ladderPosition: row.ladder_position,
    source: row.source as 'lcu' | 'league_v4',
    capturedAt: row.captured_at
  }
}

export interface SnapshotInput {
  queueType: QueueType
  tier: string | null
  rank: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
}

/** The most recent reading for one ladder, or null before anything is recorded. */
export function getLatestSnapshot(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType
): RankSnapshot | null {
  const row = db
    .prepare(
      `SELECT queue_type, tier, rank, league_points, wins, losses,
              ladder_position, source, captured_at
         FROM rank_snapshots
        WHERE account_id = ? AND queue_type = ?
        ORDER BY captured_at DESC, id DESC
        LIMIT 1`
    )
    .get(accountId, queueType) as unknown as SnapshotRow | undefined

  return row ? toSnapshot(row) : null
}

/**
 * Appends a reading, unless it repeats the previous one.
 *
 * The league-v4 backstop fires on every sync whether or not anything changed,
 * so without this the table would fill with identical rows and the graph would
 * plot a flat line made of hundreds of points. Returns the row id when a
 * snapshot was actually written, and null when it was a no-op — callers use
 * that to decide whether LP attribution needs to run.
 */
export function insertRankSnapshot(
  db: DatabaseSync,
  accountId: number,
  input: SnapshotInput,
  source: 'lcu' | 'league_v4',
  capturedAt: number = Date.now()
): number | null {
  const previous = getLatestSnapshot(db, accountId, input.queueType)
  if (
    previous &&
    previous.tier === input.tier &&
    previous.rank === input.rank &&
    previous.leaguePoints === input.leaguePoints
  ) {
    return null
  }

  const result = db
    .prepare(
      `INSERT INTO rank_snapshots
         (account_id, queue_type, tier, rank, league_points, wins, losses,
          ladder_position, source, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      accountId,
      input.queueType,
      input.tier,
      input.rank,
      input.leaguePoints,
      input.wins,
      input.losses,
      ladderPosition(input),
      source,
      capturedAt
    )

  return Number(result.lastInsertRowid)
}

/** Readings for one ladder, oldest first, optionally limited to a time window. */
export function getRankSnapshots(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType,
  sinceMs: number | null = null
): RankSnapshot[] {
  const rows = db
    .prepare(
      `SELECT queue_type, tier, rank, league_points, wins, losses,
              ladder_position, source, captured_at
         FROM rank_snapshots
        WHERE account_id = ? AND queue_type = ?
          AND (? IS NULL OR captured_at >= ?)
        ORDER BY captured_at ASC, id ASC`
    )
    .all(accountId, queueType, sinceMs, sinceMs) as unknown as SnapshotRow[]

  return rows.map(toSnapshot)
}

/**
 * Tier and division changes across the snapshot series.
 *
 * Derived on read rather than stored: a milestone is entirely a function of two
 * adjacent snapshots, so recomputing it keeps one source of truth and means a
 * fix to the movement rules applies retroactively.
 */
export function getRankMilestones(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType,
  sinceMs: number | null = null
): RankMilestone[] {
  const snapshots = getRankSnapshots(db, accountId, queueType, sinceMs)
  const milestones: RankMilestone[] = []

  for (let i = 1; i < snapshots.length; i++) {
    const movement = rankMovement(snapshots[i - 1], snapshots[i])
    if (movement === 'none') continue
    milestones.push({
      queueType,
      movement,
      tier: snapshots[i].tier,
      rank: snapshots[i].rank,
      capturedAt: snapshots[i].capturedAt
    })
  }

  return milestones.reverse()
}

export interface MatchRankInput {
  matchId: string
  accountId: number
  queueType: QueueType
  tierBefore: string | null
  rankBefore: string | null
  lpBefore: number | null
  tierAfter: string | null
  rankAfter: string | null
  lpAfter: number | null
  lpDelta: number | null
  isPromotion: boolean
  isDemotion: boolean
}

/**
 * Records what one game was worth.
 *
 * Idempotent by (match_id, account_id) so re-running attribution over the same
 * interval — which happens whenever a sync replays recent matches — corrects
 * the row instead of failing on the primary key.
 */
export function upsertMatchRank(db: DatabaseSync, input: MatchRankInput): void {
  db.prepare(
    `INSERT INTO match_rank
       (match_id, account_id, queue_type, tier_before, rank_before, lp_before,
        tier_after, rank_after, lp_after, lp_delta, is_promotion, is_demotion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(match_id, account_id) DO UPDATE SET
       queue_type = excluded.queue_type,
       tier_before = excluded.tier_before,
       rank_before = excluded.rank_before,
       lp_before = excluded.lp_before,
       tier_after = excluded.tier_after,
       rank_after = excluded.rank_after,
       lp_after = excluded.lp_after,
       lp_delta = excluded.lp_delta,
       is_promotion = excluded.is_promotion,
       is_demotion = excluded.is_demotion`
  ).run(
    input.matchId,
    input.accountId,
    input.queueType,
    input.tierBefore,
    input.rankBefore,
    input.lpBefore,
    input.tierAfter,
    input.rankAfter,
    input.lpAfter,
    input.lpDelta,
    input.isPromotion ? 1 : 0,
    input.isDemotion ? 1 : 0
  )
}

/**
 * Ranked matches for one account whose game time falls in (after, upTo].
 *
 * The attribution rule only writes LP when this returns exactly one row, so the
 * caller needs the full list rather than a count to distinguish "one game" from
 * "several games" and to know which match to attribute.
 *
 * Remakes are excluded because they move no LP. Counting them would make a real
 * game played alongside one look ambiguous, costing that game its LP figure for
 * no reason.
 */
export function getRankedMatchesBetween(
  db: DatabaseSync,
  puuid: string,
  queueId: number,
  afterMs: number,
  upToMs: number
): Array<{ matchId: string; gameCreation: number }> {
  const rows = db
    .prepare(
      `SELECT m.match_id, m.game_creation
         FROM match_participants p
         JOIN matches m ON m.match_id = p.match_id
        WHERE p.puuid = ?
          AND p.game_ended_in_early_surrender = 0
          AND m.queue_id = ?
          AND m.game_creation > ?
          AND m.game_creation <= ?
        ORDER BY m.game_creation ASC`
    )
    .all(puuid, queueId, afterMs, upToMs) as unknown as Array<{
    match_id: string
    game_creation: number
  }>

  return rows.map((row) => ({ matchId: row.match_id, gameCreation: row.game_creation }))
}
