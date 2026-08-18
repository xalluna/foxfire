import type { DatabaseSync } from 'node:sqlite'
import type {
  ManualRank,
  QueueType,
  RankMilestone,
  RankSnapshot,
  SnapshotSource
} from '@shared/types'
import { ladderPosition, rankMovement } from '@shared/ladder'
import { sameSeason } from '@shared/seasons'

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
    source: row.source as SnapshotSource,
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
 *
 * `force` overrides the dedupe, for the one caller that knows something the
 * value alone cannot say: a ranked game just ended. A loss at 0 LP with
 * demotion protection reads identically to the snapshot before it, so without
 * this the interval never closes and goes on to swallow the *next* game as
 * well, costing both of them their LP figure. Forcing is bounded at one row per
 * ranked game, which is exactly the granularity attribution wants.
 */
export function insertRankSnapshot(
  db: DatabaseSync,
  accountId: number,
  input: SnapshotInput,
  source: Exclude<SnapshotSource, 'manual'>,
  capturedAt: number = Date.now(),
  force = false
): number | null {
  const previous = getLatestSnapshot(db, accountId, input.queueType)
  if (
    !force &&
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

/**
 * Readings for one ladder, oldest first, optionally limited to a time window.
 *
 * `untilMs` is exclusive, so two adjacent ranked years tile without both
 * claiming a snapshot that lands on the instant of the boundary. Both bounds
 * default to unbounded, which leaves every existing caller — replayAttribution
 * among them — reading the whole series.
 */
export function getRankSnapshots(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType,
  sinceMs: number | null = null,
  untilMs: number | null = null
): RankSnapshot[] {
  const rows = db
    .prepare(
      `SELECT queue_type, tier, rank, league_points, wins, losses,
              ladder_position, source, captured_at
         FROM rank_snapshots
        WHERE account_id = ? AND queue_type = ?
          AND (? IS NULL OR captured_at >= ?)
          AND (? IS NULL OR captured_at < ?)
        ORDER BY captured_at ASC, id ASC`
    )
    .all(accountId, queueType, sinceMs, sinceMs, untilMs, untilMs) as unknown as SnapshotRow[]

  return rows.map(toSnapshot)
}

/**
 * Tier and division changes across the snapshot series.
 *
 * Derived on read rather than stored: a milestone is entirely a function of two
 * adjacent snapshots, so recomputing it keeps one source of truth and means a
 * fix to the movement rules applies retroactively.
 *
 * A pair spanning a ranked year is skipped. January's reset drops a Diamond
 * player to Bronze, which rankMovement can only read as a demotion — but the
 * user was not demoted, the ladder was emptied, and listing it as a milestone
 * would be a lie the all-time range tells every year forever.
 */
export function getRankMilestones(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType,
  sinceMs: number | null = null,
  untilMs: number | null = null
): RankMilestone[] {
  const snapshots = getRankSnapshots(db, accountId, queueType, sinceMs, untilMs)
  const milestones: RankMilestone[] = []

  for (let i = 1; i < snapshots.length; i++) {
    if (!sameSeason(snapshots[i - 1].capturedAt, snapshots[i].capturedAt)) continue
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

/**
 * The oldest and newest moment this account has any history for, or null when
 * it has none at all.
 *
 * Feeds the period picker. Deliberately a span rather than a DISTINCT over
 * years: a year the user did not play still sits between two they did, and a
 * picker with a hole in it reads as data loss rather than as a quiet year.
 *
 * Matches are counted for every queue, not just the ranked ones, because the
 * Champions screen uses the same list and carries its own queue filter.
 *
 * One list serves both screens, which is a deliberate trade rather than an
 * oversight: a year with non-ranked games and no rank readings at all still
 * offers a button on the Rank screen, and it lands on the empty state. Filtering
 * to the tracked queues would fix that and cost the Champions screen the years
 * it legitimately has data for, so the dead button stays.
 */
export function getHistorySpan(
  db: DatabaseSync,
  accountId: number,
  puuid: string
): { oldestMs: number; newestMs: number } | null {
  const row = db
    .prepare(
      `SELECT (SELECT MIN(captured_at) FROM rank_snapshots WHERE account_id = ?) AS snap_min,
              (SELECT MAX(captured_at) FROM rank_snapshots WHERE account_id = ?) AS snap_max,
              (SELECT MIN(m.game_creation)
                 FROM matches m
                 JOIN match_participants p ON p.match_id = m.match_id
                WHERE p.puuid = ?)                                              AS match_min,
              (SELECT MAX(m.game_creation)
                 FROM matches m
                 JOIN match_participants p ON p.match_id = m.match_id
                WHERE p.puuid = ?)                                              AS match_max`
    )
    .get(accountId, accountId, puuid, puuid) as unknown as {
    snap_min: number | null
    snap_max: number | null
    match_min: number | null
    match_max: number | null
  }

  const lows = [row.snap_min, row.match_min].filter((v): v is number => v !== null)
  const highs = [row.snap_max, row.match_max].filter((v): v is number => v !== null)
  if (lows.length === 0 || highs.length === 0) return null

  return { oldestMs: Math.min(...lows), newestMs: Math.max(...highs) }
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

/** The most recent reading strictly before a moment, or null if none precedes it. */
export function getSnapshotBefore(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType,
  beforeMs: number
): RankSnapshot | null {
  const row = db
    .prepare(
      `SELECT queue_type, tier, rank, league_points, wins, losses,
              ladder_position, source, captured_at
         FROM rank_snapshots
        WHERE account_id = ? AND queue_type = ? AND captured_at < ?
        ORDER BY captured_at DESC, id DESC
        LIMIT 1`
    )
    .get(accountId, queueType, beforeMs) as unknown as SnapshotRow | undefined

  return row ? toSnapshot(row) : null
}

/**
 * Writes one reading the user has asserted, tagged with the game it describes.
 *
 * A pure insert, paired with deleteManualSnapshot by the caller rather than
 * replacing inline: a game whose preceding reading is unusable needs two rows
 * written — the state going in as well as the state coming out — and a
 * self-clearing upsert would have the second call remove the first.
 *
 * Deliberately bypasses the insertRankSnapshot dedupe: a game that moved no LP
 * reads identically to the snapshot before it, and dropping it would leave the
 * interval open and cost the *next* game its figure too — the same reason the
 * watcher forces a row after a ranked game.
 */
export function insertManualSnapshot(
  db: DatabaseSync,
  accountId: number,
  matchId: string,
  input: SnapshotInput,
  capturedAt: number
): void {
  db.prepare(
    `INSERT INTO rank_snapshots
       (account_id, queue_type, tier, rank, league_points, wins, losses,
        ladder_position, source, captured_at, match_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
  ).run(
    accountId,
    input.queueType,
    input.tier,
    input.rank,
    input.leaguePoints,
    input.wins,
    input.losses,
    ladderPosition(input),
    capturedAt,
    matchId
  )
}

/**
 * Removes every entry the user made for one game — both the after state and, if
 * the game needed one, the before. No-op when they never made any.
 */
export function deleteManualSnapshot(db: DatabaseSync, accountId: number, matchId: string): void {
  db.prepare(
    `DELETE FROM rank_snapshots
      WHERE account_id = ? AND match_id = ? AND source = 'manual'`
  ).run(accountId, matchId)
}

export interface ManualSnapshotRow {
  matchId: string
  capturedAt: number
  rank: ManualRank
}

/**
 * Every entry the user made on one ladder.
 *
 * Carries capturedAt because a game can have two: callers tell the before state
 * from the after by which side of the game's own start time it falls on.
 */
export function getManualSnapshots(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType
): ManualSnapshotRow[] {
  const rows = db
    .prepare(
      `SELECT match_id, tier, rank, league_points, captured_at
         FROM rank_snapshots
        WHERE account_id = ? AND queue_type = ? AND source = 'manual'
          AND match_id IS NOT NULL AND tier IS NOT NULL
        ORDER BY captured_at ASC`
    )
    .all(accountId, queueType) as unknown as Array<{
    match_id: string
    tier: string
    rank: string | null
    league_points: number | null
    captured_at: number
  }>

  return rows.map((row) => ({
    matchId: row.match_id,
    capturedAt: row.captured_at,
    rank: { tier: row.tier, rank: row.rank, leaguePoints: row.league_points ?? 0 }
  }))
}

/** Which ladder a game's manual entry sits on, for scoping the rebuild after a clear. */
export function getManualSnapshotQueueType(
  db: DatabaseSync,
  accountId: number,
  matchId: string
): QueueType | null {
  const row = db
    .prepare(
      `SELECT queue_type FROM rank_snapshots
        WHERE account_id = ? AND match_id = ? AND source = 'manual'
        LIMIT 1`
    )
    .get(accountId, matchId) as unknown as { queue_type: string } | undefined

  return row ? (row.queue_type as QueueType) : null
}

/**
 * Drops the user's entries that a live reading has just measured for them.
 *
 * A manual snapshot asserts a ladder position at a moment. A real reading taken
 * later with no ranked game in between measures that same position directly, so
 * it settles the question and the assertion has nothing left to add — if the two
 * disagree, the assertion was simply wrong.
 *
 * The "no game in between" test is what keeps this from eating a legitimate run:
 * with three games hand-fixed and a sync landing after the third, a game sits
 * between every entry and the reading, so all of them survive.
 *
 * Returns how many were removed; callers rebuild attribution when that is
 * non-zero, since the rows derived from them are now stale.
 */
export function deleteSupersededManualSnapshots(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueType: QueueType,
  queueId: number,
  atMs: number
): number {
  const result = db
    .prepare(
      `DELETE FROM rank_snapshots
        WHERE account_id = ? AND queue_type = ? AND source = 'manual'
          AND captured_at <= ?
          AND NOT EXISTS (
                SELECT 1
                  FROM match_participants p
                  JOIN matches m ON m.match_id = p.match_id
                 WHERE p.puuid = ?
                   AND p.game_ended_in_early_surrender = 0
                   AND m.queue_id = ?
                   AND m.game_creation > rank_snapshots.captured_at
                   AND m.game_creation <= ?
              )`
    )
    .run(accountId, queueType, atMs, puuid, queueId, atMs)

  return Number(result.changes)
}

/**
 * Clears the derived LP for one ladder, ahead of a replay.
 *
 * upsertMatchRank corrects and inserts but never deletes, so removing a manual
 * snapshot would otherwise strand the row it produced: attribution would find
 * the interval ambiguous again, write nothing, and the stale hand-entered value
 * would sit there looking measured. Wiping first makes every manual mutation a
 * rebuild from snapshots, which is lossless — match_rank holds nothing that is
 * not derived from them.
 */
export function deleteMatchRankForQueue(
  db: DatabaseSync,
  accountId: number,
  queueType: QueueType
): void {
  db.prepare('DELETE FROM match_rank WHERE account_id = ? AND queue_type = ?').run(
    accountId,
    queueType
  )
}

export interface UnattributedMatchRow {
  matchId: string
  gameCreation: number
  gameDuration: number
  win: boolean
  championId: number
  championName: string | null
  kills: number
  deaths: number
  assists: number
}

/**
 * The ranked games the editor can offer, newest first.
 *
 * Remakes are left out for the same reason attribution ignores them: they move
 * no LP, so there is nothing to enter. Games attribution worked out on its own
 * are left out too, since a measured value needs no assertion over it.
 *
 * A game the user has already entered stays in, even though it now has a
 * figure — it only has one because they supplied it, and dropping it the moment
 * it was saved would mean a typo could only be corrected by clearing the entry
 * and starting again.
 *
 * Newest first to match the match list, and because a gap worth fixing is
 * nearly always a recent one: a backlog reaching to the start of the season
 * would otherwise bury this week's games under months of history.
 */
export function getEditableRankedMatches(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueId: number
): UnattributedMatchRow[] {
  const rows = db
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration,
              p.win, p.champion_id, p.champion_name, p.kills, p.deaths, p.assists
         FROM match_participants p
         JOIN matches m ON m.match_id = p.match_id
         LEFT JOIN match_rank mr ON mr.match_id = p.match_id AND mr.account_id = ?
        WHERE p.puuid = ?
          AND p.game_ended_in_early_surrender = 0
          AND m.queue_id = ?
          AND (mr.match_id IS NULL OR mr.lp_delta IS NULL
               OR EXISTS (SELECT 1 FROM rank_snapshots rs
                           WHERE rs.match_id = p.match_id
                             AND rs.account_id = mr.account_id
                             AND rs.source = 'manual'))
        ORDER BY m.game_creation DESC`
    )
    .all(accountId, puuid, queueId) as unknown as Array<{
    match_id: string
    game_creation: number
    game_duration: number
    win: number
    champion_id: number
    champion_name: string | null
    kills: number
    deaths: number
    assists: number
  }>

  return rows.map((row) => ({
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    win: row.win === 1,
    championId: row.champion_id,
    championName: row.champion_name,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists
  }))
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
