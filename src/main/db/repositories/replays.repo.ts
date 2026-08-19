import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Replay,
  ReplayBindState,
  ReplayEvent,
  ReplayEventRole,
  ReplayMatchInfo
} from '@shared/types'

/** What is known about a recording at the moment it starts. */
export interface NewReplay {
  accountId: number
  filePath: string
  queueId: number | null
  startedAt: number
  /** The game clock when the first frame was written — see the migration. */
  gameTimeOffset: number
  selfChampionId: number | null
  /** Champion ids of all ten players, the fingerprint the match is found by. */
  roster: number[]
}

interface ReplayRow {
  id: number
  account_id: number
  match_id: string | null
  bind_state: string
  file_path: string
  file_bytes: number | null
  queue_id: number | null
  started_at: number
  ended_at: number | null
  game_time_offset: number
  self_champion_id: number | null
  roster_json: string | null
  // All null unless the replay is bound and the match is still stored.
  m_game_creation: number | null
  m_game_duration: number | null
  m_game_mode: string | null
  m_queue_id: number | null
  m_win: number | null
  m_champion_id: number | null
  m_champion_name: string | null
  m_kills: number | null
  m_deaths: number | null
  m_assists: number | null
}

/**
 * The bound match, joined through the tracked account's own participant row.
 *
 * Selected alongside the replay rather than fetched per row: the Replays view
 * and every match row context menu both need it, and it is the same single
 * query either way.
 */
const SELECT_REPLAY = `
  SELECT r.id, r.account_id, r.match_id, r.bind_state, r.file_path, r.file_bytes,
         r.queue_id, r.started_at, r.ended_at, r.game_time_offset,
         r.self_champion_id, r.roster_json,
         m.game_creation AS m_game_creation, m.game_duration AS m_game_duration,
         m.game_mode AS m_game_mode, m.queue_id AS m_queue_id,
         p.win AS m_win, p.champion_id AS m_champion_id, p.champion_name AS m_champion_name,
         p.kills AS m_kills, p.deaths AS m_deaths, p.assists AS m_assists
    FROM replays r
    LEFT JOIN matches m ON m.match_id = r.match_id
    LEFT JOIN match_participants p
      ON p.match_id = r.match_id
     AND p.puuid = (SELECT puuid FROM accounts WHERE id = r.account_id)`

function toMatchInfo(row: ReplayRow): ReplayMatchInfo | null {
  if (row.match_id === null || row.m_game_creation === null || row.m_champion_id === null) {
    return null
  }
  return {
    matchId: row.match_id,
    gameCreation: row.m_game_creation,
    gameDuration: row.m_game_duration ?? 0,
    gameMode: row.m_game_mode,
    queueId: row.m_queue_id,
    win: row.m_win === 1,
    championId: row.m_champion_id,
    championName: row.m_champion_name,
    kills: row.m_kills ?? 0,
    deaths: row.m_deaths ?? 0,
    assists: row.m_assists ?? 0
  }
}

function toReplay(row: ReplayRow): Replay {
  return {
    id: row.id,
    accountId: row.account_id,
    matchId: row.match_id,
    bindState: row.bind_state as ReplayBindState,
    fileBytes: row.file_bytes,
    // Checked on read rather than trusted from the row: the replay folder is an
    // ordinary one the user can open in Explorer, and a file deleted from under
    // us should read as missing rather than as a replay that fails to play.
    fileExists: existsSync(row.file_path),
    queueId: row.queue_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds:
      row.ended_at === null ? null : Math.round((row.ended_at - row.started_at) / 1000),
    selfChampionId: row.self_champion_id,
    match: toMatchInfo(row)
  }
}

export function createReplay(db: DatabaseSync, input: NewReplay): number {
  db.prepare(
    `INSERT INTO replays
       (account_id, file_path, queue_id, started_at, game_time_offset, self_champion_id, roster_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.accountId,
    input.filePath,
    input.queueId,
    input.startedAt,
    input.gameTimeOffset,
    input.selfChampionId,
    JSON.stringify(input.roster)
  )

  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as unknown as { id: number }
  return row.id
}

/**
 * Closes out a recording.
 *
 * The path is rewritten as well, because OBS names the file itself and only
 * reports that name when it says the recording stopped.
 */
export function finishReplay(
  db: DatabaseSync,
  replayId: number,
  endedAt: number,
  filePath: string,
  fileBytes: number | null
): void {
  db.prepare('UPDATE replays SET ended_at = ?, file_path = ?, file_bytes = ? WHERE id = ?').run(
    endedAt,
    filePath,
    fileBytes,
    replayId
  )
}

/**
 * Stores events, ignoring any already seen.
 *
 * The game serves its whole event list on every poll, so this is called
 * repeatedly with overlapping input by design.
 */
export function insertReplayEvents(
  db: DatabaseSync,
  replayId: number,
  events: readonly ReplayEvent[]
): void {
  if (events.length === 0) return

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO replay_events
       (replay_id, event_id, name, game_time, video_time, role, label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  db.exec('BEGIN')
  try {
    for (const event of events) {
      stmt.run(
        replayId,
        event.eventId,
        event.name,
        event.gameTime,
        event.videoTime,
        event.role,
        event.label
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function getReplays(db: DatabaseSync, accountId: number): Replay[] {
  const rows = db
    .prepare(`${SELECT_REPLAY} WHERE r.account_id = ? ORDER BY r.started_at DESC`)
    .all(accountId) as unknown as ReplayRow[]
  return rows.map(toReplay)
}

export function getReplay(db: DatabaseSync, replayId: number): Replay | null {
  const row = db.prepare(`${SELECT_REPLAY} WHERE r.id = ?`).get(replayId) as unknown as
    | ReplayRow
    | undefined
  return row ? toReplay(row) : null
}

export function getReplayEvents(db: DatabaseSync, replayId: number): ReplayEvent[] {
  const rows = db
    .prepare(
      `SELECT event_id, name, game_time, video_time, role, label
         FROM replay_events WHERE replay_id = ? ORDER BY video_time`
    )
    .all(replayId) as unknown as Array<{
    event_id: number
    name: string
    game_time: number
    video_time: number
    role: string
    label: string | null
  }>

  return rows.map((row) => ({
    eventId: row.event_id,
    name: row.name,
    gameTime: row.game_time,
    videoTime: row.video_time,
    role: row.role as ReplayEventRole,
    label: row.label
  }))
}

/**
 * The file behind a replay id.
 *
 * The only way the replay:// protocol learns a path. The renderer never sends
 * one, so a compromised window cannot name a file outside the replay folder.
 */
export function getReplayFilePath(db: DatabaseSync, replayId: number): string | null {
  const row = db.prepare('SELECT file_path FROM replays WHERE id = ?').get(replayId) as unknown as
    | { file_path: string }
    | undefined
  return row?.file_path ?? null
}

/** Removes the row and returns the file the caller should now unlink. */
export function deleteReplay(db: DatabaseSync, replayId: number): string | null {
  const path = getReplayFilePath(db, replayId)
  db.prepare('DELETE FROM replays WHERE id = ?').run(replayId)
  return path
}

export interface BindableReplay {
  id: number
  accountId: number
  startedAt: number
  endedAt: number | null
  roster: number[]
  selfChampionId: number | null
}

/**
 * Finished recordings worth trying to bind.
 *
 * Not only the pending ones. Giving up is a conclusion drawn from a single pass,
 * and that pass can be wrong: a key that expired overnight means the match was
 * simply not in SQLite yet, not that it does not exist. So recordings already
 * written off are reconsidered too, back as far as `retryUnmatchedSince`.
 *
 * That cutoff is what keeps the reconsidering bounded. A Practice Tool game
 * produces no match and never will, and without a cutoff it would be rescanned
 * on every sync for the life of the library — dragging the caller's candidate
 * window back to the day it was recorded along with it.
 */
export function getBindableReplays(
  db: DatabaseSync,
  accountId: number,
  retryUnmatchedSince: number
): BindableReplay[] {
  const rows = db
    .prepare(
      `SELECT id, account_id, started_at, ended_at, roster_json, self_champion_id
         FROM replays
        WHERE account_id = ?
          AND ended_at IS NOT NULL
          AND (bind_state = 'pending'
               OR (bind_state = 'unmatched' AND started_at >= ?))
        ORDER BY started_at DESC`
    )
    .all(accountId, retryUnmatchedSince) as unknown as Array<{
    id: number
    account_id: number
    started_at: number
    ended_at: number | null
    roster_json: string | null
    self_champion_id: number | null
  }>

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    roster: row.roster_json ? (JSON.parse(row.roster_json) as number[]) : [],
    selfChampionId: row.self_champion_id
  }))
}

export function bindReplay(db: DatabaseSync, replayId: number, matchId: string): void {
  db.prepare("UPDATE replays SET match_id = ?, bind_state = 'bound' WHERE id = ?").run(
    matchId,
    replayId
  )
}

/**
 * Gives up on finding a match for a recording.
 *
 * A resting state rather than a failure: a Practice Tool game produces no
 * match-v5 match and never will. The file is left exactly where it is.
 */
export function markReplayUnmatched(db: DatabaseSync, replayId: number): void {
  db.prepare("UPDATE replays SET bind_state = 'unmatched' WHERE id = ?").run(replayId)
}

/** Whether a match is already spoken for, so two replays cannot claim one game. */
export function matchAlreadyBound(db: DatabaseSync, matchId: string): boolean {
  return db.prepare('SELECT 1 AS x FROM replays WHERE match_id = ?').get(matchId) !== undefined
}

export interface ReplayUsageRow {
  totalBytes: number
  count: number
  unmatchedCount: number
}

export function getReplayUsage(db: DatabaseSync): ReplayUsageRow {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(file_bytes), 0) AS total_bytes,
              COUNT(*) AS count,
              SUM(CASE WHEN bind_state = 'unmatched' THEN 1 ELSE 0 END) AS unmatched
         FROM replays`
    )
    .get() as unknown as { total_bytes: number; count: number; unmatched: number | null }

  return {
    totalBytes: row.total_bytes,
    count: row.count,
    unmatchedCount: row.unmatched ?? 0
  }
}

/** How many replay files are no longer on disk, for the missing-files warning. */
export function countMissingFiles(db: DatabaseSync): number {
  const rows = db.prepare('SELECT file_path FROM replays').all() as unknown as Array<{
    file_path: string
  }>
  return rows.filter((row) => !existsSync(row.file_path)).length
}

/** The N oldest recordings for an account — what the cleanup button deletes. */
export function getOldestReplayIds(db: DatabaseSync, accountId: number, count: number): number[] {
  const rows = db
    .prepare('SELECT id FROM replays WHERE account_id = ? ORDER BY started_at ASC LIMIT ?')
    .all(accountId, count) as unknown as Array<{ id: number }>
  return rows.map((row) => row.id)
}
