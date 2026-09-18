import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { ownedBy, ownedByParams, type AccountContext } from '../accountScope'
import type {
  Recording,
  RecordingBindState,
  RecordingEvent,
  RecordingEventRole,
  LinkedMatchInfo
} from '@shared/types'

/** What is known about a recording at the moment it starts. */
export interface NewRecording {
  accountId: string

  /** `gameName#tagLine`, which is what finds this row again after a server change. */
  riotId: string | null

  /** The active server's URL, or null in local-only mode. */
  serverKey: string | null
  filePath: string
  queueId: number | null
  startedAt: number
  /** The game clock when the first frame was written — see the migration. */
  gameTimeOffset: number
  selfChampionId: number | null
  /** Champion ids of all ten players, the fingerprint the match is found by. */
  roster: number[]
}

interface RecordingRow {
  id: number
  account_id: string
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
  // All null unless the recording is bound and the match is still stored.
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
 * Selected alongside the recording rather than fetched per row: the Recordings view
 * and every match row context menu both need it, and it is the same single
 * query either way.
 */
const SELECT_RECORDING = `
  SELECT r.id, r.account_id, r.match_id, r.bind_state, r.file_path, r.file_bytes,
         r.queue_id, r.started_at, r.ended_at, r.game_time_offset,
         r.self_champion_id, r.roster_json,
         m.game_creation AS m_game_creation, m.game_duration AS m_game_duration,
         m.game_mode AS m_game_mode, m.queue_id AS m_queue_id,
         p.win AS m_win, p.champion_id AS m_champion_id, p.champion_name AS m_champion_name,
         p.kills AS m_kills, p.deaths AS m_deaths, p.assists AS m_assists
    FROM recordings r
    LEFT JOIN matches m ON m.match_id = r.match_id
    LEFT JOIN match_participants p
      ON p.match_id = r.match_id
     AND p.puuid = (SELECT puuid FROM accounts WHERE id = r.account_id)`

function toMatchInfo(row: RecordingRow): LinkedMatchInfo | null {
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

function toRecording(row: RecordingRow): Recording {
  return {
    id: row.id,
    accountId: row.account_id,
    matchId: row.match_id,
    bindState: row.bind_state as RecordingBindState,
    fileBytes: row.file_bytes,
    // Checked on read rather than trusted from the row: the recording folder is an
    // ordinary one the user can open in Explorer, and a file deleted from under
    // us should read as missing rather than as a recording that fails to play.
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

export function createRecording(db: DatabaseSync, input: NewRecording): number {
  db.prepare(
    `INSERT INTO recordings
       (account_id, riot_id, server_key, file_path, queue_id, started_at,
        game_time_offset, self_champion_id, roster_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.accountId,
    input.riotId,
    input.serverKey,
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
export function finishRecording(
  db: DatabaseSync,
  recordingId: number,
  endedAt: number,
  filePath: string,
  fileBytes: number | null
): void {
  db.prepare('UPDATE recordings SET ended_at = ?, file_path = ?, file_bytes = ? WHERE id = ?').run(
    endedAt,
    filePath,
    fileBytes,
    recordingId
  )
}

/**
 * Stores events, ignoring any already seen.
 *
 * The game serves its whole event list on every poll, so this is called
 * repeatedly with overlapping input by design.
 */
export function insertRecordingEvents(
  db: DatabaseSync,
  recordingId: number,
  events: readonly RecordingEvent[]
): void {
  if (events.length === 0) return

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO recording_events
       (recording_id, event_id, name, game_time, video_time, role, label)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  db.exec('BEGIN')
  try {
    for (const event of events) {
      stmt.run(
        recordingId,
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

export function getRecordings(db: DatabaseSync, account: AccountContext): Recording[] {
  const rows = db
    .prepare(
      `${SELECT_RECORDING}
        WHERE ${ownedBy('r.account_id', 'r.riot_id')}
        ORDER BY r.started_at DESC`
    )
    .all(...ownedByParams(account)) as unknown as RecordingRow[]
  return rows.map(toRecording)
}

export function getRecording(db: DatabaseSync, recordingId: number): Recording | null {
  const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(recordingId) as unknown as
    | RecordingRow
    | undefined
  return row ? toRecording(row) : null
}

export function getRecordingEvents(db: DatabaseSync, recordingId: number): RecordingEvent[] {
  const rows = db
    .prepare(
      `SELECT event_id, name, game_time, video_time, role, label
         FROM recording_events WHERE recording_id = ? ORDER BY video_time`
    )
    .all(recordingId) as unknown as Array<{
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
    role: row.role as RecordingEventRole,
    label: row.label
  }))
}

/**
 * The file behind a recording id.
 *
 * The only way the recording:// protocol learns a path. The renderer never sends
 * one, so a compromised window cannot name a file outside the recording folder.
 */
export function getRecordingFilePath(db: DatabaseSync, recordingId: number): string | null {
  const row = db.prepare('SELECT file_path FROM recordings WHERE id = ?').get(recordingId) as unknown as
    | { file_path: string }
    | undefined
  return row?.file_path ?? null
}

/** Removes the row and returns the file the caller should now unlink. */
export function deleteRecording(db: DatabaseSync, recordingId: number): string | null {
  const path = getRecordingFilePath(db, recordingId)
  db.prepare('DELETE FROM recordings WHERE id = ?').run(recordingId)
  return path
}

export interface BindableRecording {
  id: number
  accountId: string
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
export function getBindableRecordings(
  db: DatabaseSync,
  account: AccountContext,
  retryUnmatchedSince: number
): BindableRecording[] {
  const rows = db
    .prepare(
      `SELECT id, account_id, started_at, ended_at, roster_json, self_champion_id
         FROM recordings
        WHERE ${ownedBy('account_id', 'riot_id')}
          AND ended_at IS NOT NULL
          AND (bind_state = 'pending'
               OR (bind_state = 'unmatched' AND started_at >= ?))
        ORDER BY started_at DESC`
    )
    .all(...ownedByParams(account), retryUnmatchedSince) as unknown as Array<{
    id: number
    account_id: string
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

export function bindRecording(db: DatabaseSync, recordingId: number, matchId: string): void {
  db.prepare("UPDATE recordings SET match_id = ?, bind_state = 'bound' WHERE id = ?").run(
    matchId,
    recordingId
  )
}

/**
 * Gives up on finding a match for a recording.
 *
 * A resting state rather than a failure: a Practice Tool game produces no
 * match-v5 match and never will. The file is left exactly where it is.
 */
export function markRecordingUnmatched(db: DatabaseSync, recordingId: number): void {
  db.prepare("UPDATE recordings SET bind_state = 'unmatched' WHERE id = ?").run(recordingId)
}

/** Whether a match is already spoken for, so two recordings cannot claim one game. */
export function matchAlreadyBound(db: DatabaseSync, matchId: string): boolean {
  return db.prepare('SELECT 1 AS x FROM recordings WHERE match_id = ?').get(matchId) !== undefined
}

export interface RecordingUsageRow {
  totalBytes: number
  count: number
  unmatchedCount: number
}

export function getRecordingUsage(db: DatabaseSync): RecordingUsageRow {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(file_bytes), 0) AS total_bytes,
              COUNT(*) AS count,
              SUM(CASE WHEN bind_state = 'unmatched' THEN 1 ELSE 0 END) AS unmatched
         FROM recordings`
    )
    .get() as unknown as { total_bytes: number; count: number; unmatched: number | null }

  return {
    totalBytes: row.total_bytes,
    count: row.count,
    unmatchedCount: row.unmatched ?? 0
  }
}

/** How many recording files are no longer on disk, for the missing-files warning. */
export function countMissingFiles(db: DatabaseSync): number {
  const rows = db.prepare('SELECT file_path FROM recordings').all() as unknown as Array<{
    file_path: string
  }>
  return rows.filter((row) => !existsSync(row.file_path)).length
}

/** The N oldest recordings for an account — what the cleanup button deletes. */
export function getOldestRecordingIds(
  db: DatabaseSync,
  account: AccountContext,
  count: number
): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM recordings
        WHERE ${ownedBy('account_id', 'riot_id')}
        ORDER BY started_at ASC LIMIT ?`
    )
    .all(...ownedByParams(account), count) as unknown as Array<{ id: number }>
  return rows.map((row) => row.id)
}

/**
 * The recording for each of these matches, for one account.
 *
 * One query for a whole page of history rather than one per row. In server mode
 * the match list arrives over HTTP with no idea what is on this disk, and this
 * is what fills the gap — twenty round trips to the same table to answer twenty
 * yes/no questions is twenty for nothing.
 *
 * Scoped to the account, unlike replays: a game two people played together is
 * one match row each, and only one of them has the footage.
 */
export function getRecordingIdsForMatches(
  db: DatabaseSync,
  account: AccountContext,
  matchIds: string[]
): Map<string, number> {
  if (matchIds.length === 0) return new Map()

  const placeholders = matchIds.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT match_id, MAX(id) AS id
         FROM recordings
        WHERE match_id IN (${placeholders})
          AND ${ownedBy('account_id', 'riot_id')}
        GROUP BY match_id`
    )
    .all(...matchIds, ...ownedByParams(account)) as unknown as Array<{
    match_id: string
    id: number
  }>

  return new Map(rows.map((row) => [row.match_id, row.id]))
}

/**
 * Which of these matches a recording already claims.
 *
 * Asked separately from the candidates rather than folded into them, because
 * the candidates can come from a server and a recording cannot: it is a file on
 * this disk, and no server knows one exists. Two back-to-back games on the same
 * champion are why it is asked at all — without it, the second recording would
 * bind to the first game.
 */
export function takenMatchIds(db: DatabaseSync, matchIds: string[]): Set<string> {
  if (matchIds.length === 0) return new Set()

  const placeholders = matchIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT DISTINCT match_id FROM recordings WHERE match_id IN (${placeholders})`)
    .all(...matchIds) as unknown as Array<{ match_id: string }>

  return new Set(rows.map((row) => row.match_id))
}
