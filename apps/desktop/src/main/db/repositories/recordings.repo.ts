import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { Account, GameId, TftTrait, TftUnit } from '@foxfire/core'
import { ownedBy, ownedByParams, type AccountContext } from '../accountScope'
import {
  canUploadRecording,
  serverAccountFor,
  PENDING_UPLOAD_STATES as PENDING_UPLOAD_STATES_SHARED
} from '@shared/uploadEligibility'
import type {
  Recording,
  RecordingBindState,
  RecordingEvent,
  RecordingEventRole,
  RecordingFilter,
  RecordingPlayer,
  LinkedMatchInfo,
  LinkedTftMatchInfo,
  UploadState,
  UploadTrigger
} from '@shared/types'

/** The server's "mine": the accounts an upload may go up under. */
type OwnAccounts = readonly Pick<Account, 'id' | 'gameName' | 'tagLine' | 'isMine'>[]

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
  /** League's unless it says; TFT's is bound by its game id rather than a roster. */
  game?: GameId
  /** Riot's id for the game and the platform it was on, which together are its match id. */
  gameId?: number | null
  platformId?: string | null
}

interface RecordingRow {
  id: number
  account_id: string
  riot_id: string | null
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
  server_video_id: string | null
  server_video_key: string | null
  server_video_at: number | null
  file_deleted_at: number | null
  // Null unless an upload has been queued.
  u_state: string | null
  u_trigger: string | null
  u_confirmed_offset: number | null
  u_file_bytes: number | null
  u_delete_after: number | null
  u_last_error: string | null
  u_next_attempt_at: number | null
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
  game: string
  // All null unless the recording is a bound TFT game with the board still stored.
  t_placement: number | null
  t_team_placement: number | null
  t_time_eliminated: number | null
  t_traits_json: string | null
  t_units_json: string | null
}

/**
 * The player a recording was made on, `gameName#tagLine`: the row's own, and
 * failing that this PC's account of that id — a local-only id is this
 * machine's rowid, as text. A row written while the server could not be
 * reached carries only the server's id, which no account here has, and stays
 * null.
 */
const RECORDING_RIOT_ID = `COALESCE(r.riot_id,
  (SELECT a.game_name || '#' || a.tag_line FROM accounts a WHERE CAST(a.id AS TEXT) = r.account_id))`

/**
 * The bound match, joined through the tracked account's own participant row.
 *
 * Selected alongside the recording rather than fetched per row: the Recordings view
 * and every match row context menu both need it, and it is the same single
 * query either way. So is its upload.
 */
const SELECT_RECORDING = `
  SELECT r.id, r.account_id, ${RECORDING_RIOT_ID} AS riot_id,
         r.match_id, r.bind_state, r.file_path, r.file_bytes,
         r.queue_id, r.started_at, r.ended_at, r.game_time_offset,
         r.self_champion_id, r.roster_json,
         r.server_video_id, r.server_video_key, r.server_video_at, r.file_deleted_at,
         u.state AS u_state, u.trigger AS u_trigger, u.confirmed_offset AS u_confirmed_offset,
         u.file_bytes AS u_file_bytes, u.delete_after AS u_delete_after, u.last_error AS u_last_error,
         u.next_attempt_at AS u_next_attempt_at,
         m.game_creation AS m_game_creation, m.game_duration AS m_game_duration,
         m.game_mode AS m_game_mode, m.queue_id AS m_queue_id,
         p.win AS m_win, p.champion_id AS m_champion_id, p.champion_name AS m_champion_name,
         p.kills AS m_kills, p.deaths AS m_deaths, p.assists AS m_assists,
         r.game,
         t.placement AS t_placement, t.team_placement AS t_team_placement,
         t.time_eliminated AS t_time_eliminated, t.traits_json AS t_traits_json, t.units_json AS t_units_json
    FROM recordings r
    LEFT JOIN media_uploads u ON u.recording_id = r.id
    LEFT JOIN matches m ON m.match_id = r.match_id
    LEFT JOIN match_participants p
      ON p.match_id = r.match_id
     AND p.puuid = (SELECT puuid FROM accounts WHERE id = r.account_id)
    -- A TFT recording's board, under the account's TFT key's id while it has
    -- one and its own puuid otherwise — see services/tftIdentity.ts.
    LEFT JOIN tft_participants t
      ON r.game = 'tft'
     AND t.match_id = r.match_id
     AND t.puuid = COALESCE(
           (SELECT puuid FROM account_scoped_puuids WHERE account_id = r.account_id AND scope = 'tft'),
           (SELECT puuid FROM accounts WHERE id = r.account_id))`

/** A bound TFT game's board, as this PC holds it. */
function toTftMatchInfo(row: RecordingRow): LinkedTftMatchInfo | null {
  if (row.match_id === null || row.m_game_creation === null || row.t_placement === null) return null
  return {
    matchId: row.match_id,
    gameCreation: row.m_game_creation,
    gameDuration: row.m_game_duration ?? 0,
    queueId: row.m_queue_id,
    placement: row.t_placement,
    teamPlacement: row.t_team_placement,
    timeEliminated: row.t_time_eliminated ?? 0,
    traits: row.t_traits_json ? (JSON.parse(row.t_traits_json) as TftTrait[]) : [],
    units: row.t_units_json ? (JSON.parse(row.t_units_json) as TftUnit[]) : []
  }
}

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
    riotId: row.riot_id,
    matchId: row.match_id,
    bindState: row.bind_state as RecordingBindState,
    fileBytes: row.file_bytes,
    // Checked on read rather than trusted from the row: the recording folder is an
    // ordinary one the user can open in Explorer, and a file deleted from under
    // us should read as missing rather than as a recording that fails to play.
    fileExists: row.file_deleted_at === null && existsSync(row.file_path),
    queueId: row.queue_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds:
      row.ended_at === null ? null : Math.round((row.ended_at - row.started_at) / 1000),
    selfChampionId: row.self_champion_id,
    game: row.game === 'tft' ? 'tft' : 'lol',
    match: toMatchInfo(row),
    tftMatch: row.game === 'tft' ? toTftMatchInfo(row) : null,
    fileDeleted: row.file_deleted_at !== null,
    server:
      row.server_video_id === null || row.server_video_key === null
        ? null
        : { videoId: row.server_video_id, serverKey: row.server_video_key, at: row.server_video_at ?? 0 },
    upload:
      row.u_state === null
        ? null
        : {
            state: row.u_state as UploadState,
            trigger: (row.u_trigger === 'auto' || row.u_trigger === 'bulk' ? row.u_trigger : 'manual') as UploadTrigger,
            bytesSent: row.u_confirmed_offset ?? 0,
            fileBytes: row.u_file_bytes,
            deleteAfter: row.u_delete_after === 1,
            error: row.u_last_error,
            resumesAt: row.u_next_attempt_at
          }
  }
}

export function createRecording(db: DatabaseSync, input: NewRecording): number {
  db.prepare(
    `INSERT INTO recordings
       (account_id, riot_id, server_key, file_path, queue_id, started_at,
        game_time_offset, self_champion_id, roster_json, game, game_id, platform_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.accountId,
    input.riotId,
    input.serverKey,
    input.filePath,
    input.queueId,
    input.startedAt,
    input.gameTimeOffset,
    input.selfChampionId,
    JSON.stringify(input.roster),
    input.game ?? 'lol',
    input.gameId ?? null,
    input.platformId ?? null
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

/**
 * The Recordings tab's filter as SQL over `r`, with its bind parameters: one
 * game's, one player's, both, or every recording on this PC.
 */
function filterClause(filter: RecordingFilter): { sql: string; params: Array<string | null> } {
  const game = filter.game ?? null
  const player = filter.player ?? null
  return {
    sql: `(? IS NULL OR r.game = ?) AND (? IS NULL OR lower(${RECORDING_RIOT_ID}) = lower(?))`,
    params: [game, game, player, player]
  }
}

/**
 * A page of the recordings on this PC, newest first, whoever played them — one
 * game's or one player's when the Recordings tab is filtered to it.
 *
 * Not one account's. The files are on this disk whichever account is picked
 * in the rail, and a list scoped to one of them left the rest out of reach of
 * everything the tab offers: the size above it counted them, and nothing in it
 * could delete them.
 *
 * The id breaks ties so a page boundary cannot fall between two recordings that
 * started in the same millisecond and come back in the other order next time.
 */
export function getRecordings(
  db: DatabaseSync,
  filter: RecordingFilter,
  page: { limit: number; offset: number }
): Recording[] {
  const where = filterClause(filter)
  const rows = db
    .prepare(
      `${SELECT_RECORDING}
        WHERE ${where.sql}
        ORDER BY r.started_at DESC, r.id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...where.params, page.limit, page.offset) as unknown as RecordingRow[]
  return rows.map(toRecording)
}

/** How many recordings the filter leaves — the total beside a page of {@link getRecordings}. */
export function countRecordings(db: DatabaseSync, filter: RecordingFilter): number {
  const where = filterClause(filter)
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM recordings r WHERE ${where.sql}`)
    .get(...where.params) as { n: number }
  return row.n
}

/**
 * Every player with a recording on this PC, and how many, most first — what
 * the Recordings tab's player filter offers. Spellings that differ only in
 * case are one player. A recording nobody can name is in no player's count.
 */
export function getRecordingPlayers(db: DatabaseSync): RecordingPlayer[] {
  const rows = db
    .prepare(
      `SELECT MIN(riot_id) AS riot_id, COUNT(*) AS n
         FROM (SELECT ${RECORDING_RIOT_ID} AS riot_id FROM recordings r)
        WHERE riot_id IS NOT NULL
        GROUP BY lower(riot_id)
        ORDER BY n DESC, lower(riot_id) ASC`
    )
    .all() as unknown as Array<{ riot_id: string; n: number }>
  return rows.map((row) => ({ riotId: row.riot_id, count: row.n }))
}

/**
 * Rows on this PC that could go to this server as far as the file goes: on
 * disk, bound to its game, not on the server, nothing on its way. Whose they
 * are is left to the caller. A function only because the list of pending
 * states is defined further down.
 */
function uploadableRows(): string {
  return `
        WHERE r.file_deleted_at IS NULL
          AND r.match_id IS NOT NULL
          AND (r.server_video_key IS NULL OR r.server_video_key <> ?)
          AND (u.state IS NULL OR u.state NOT IN (${PENDING_UPLOAD_STATES}))`
}

/**
 * Every recording on this PC that you could send to the server, newest first.
 *
 * Whole rather than a page, deliberately: it is what "select all" on the
 * Recordings tab selects, and the batch it starts reads each one's size and
 * game. SQL narrows it to rows with a file and a game, not on this server, and
 * no upload on its way; the shared rule then has the last word — it is the one
 * the tab draws its Upload buttons by, it checks that each file is still on
 * disk, and it keeps only what was recorded on one of `mine`, the server's
 * answer to whose accounts are yours. Anybody else's game recorded on this PC
 * is listed, but the server would refuse its upload.
 */
export function getUploadableRecordings(db: DatabaseSync, serverKey: string | null, mine: OwnAccounts): Recording[] {
  if (serverKey === null) return []
  const rows = db
    .prepare(`${SELECT_RECORDING} ${uploadableRows()} ORDER BY r.started_at DESC, r.id DESC`)
    .all(serverKey) as unknown as RecordingRow[]
  return rows.map(toRecording).filter((recording) => canUploadRecording(recording, serverKey, mine))
}

/**
 * The same recordings, oldest first, as ids: what "upload everything" queues.
 * Whole, because a backlog is the point of it.
 */
export function getUploadableRecordingIds(db: DatabaseSync, serverKey: string, mine: OwnAccounts): number[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.account_id, ${RECORDING_RIOT_ID} AS riot_id, r.file_path
         FROM recordings r
         LEFT JOIN media_uploads u ON u.recording_id = r.id
       ${uploadableRows()}
        ORDER BY r.started_at ASC, r.id ASC`
    )
    .all(serverKey) as unknown as Array<{ id: number; account_id: string; riot_id: string | null; file_path: string }>
  return rows
    .filter((row) => serverAccountFor({ accountId: row.account_id, riotId: row.riot_id }, mine) !== null)
    .filter((row) => existsSync(row.file_path))
    .map((row) => row.id)
}

/** One recording. */
export function getRecording(db: DatabaseSync, recordingId: number): Recording | null {
  const row = db.prepare(`${SELECT_RECORDING} WHERE r.id = ?`).get(recordingId) as unknown as
    | RecordingRow
    | undefined
  return row ? toRecording(row) : null
}

/** Whose a recording is, which game, and what the server already has — what the uploader works from. */
export interface RecordingIdentity {
  id: number
  accountId: string
  riotId: string | null
  serverKey: string | null
  matchId: string | null
  filePath: string
  fileDeleted: boolean
  serverVideoId: string | null
  serverVideoKey: string | null
  game: GameId
  /** Epoch milliseconds. */
  startedAt: number
  durationSeconds: number | null
}

export function getRecordingIdentity(db: DatabaseSync, recordingId: number): RecordingIdentity | null {
  const row = db
    .prepare(
      `SELECT id, account_id, riot_id, server_key, match_id, file_path, file_deleted_at,
              server_video_id, server_video_key, game, started_at, ended_at
         FROM recordings WHERE id = ?`
    )
    .get(recordingId) as unknown as
    | {
        id: number
        account_id: string
        riot_id: string | null
        server_key: string | null
        match_id: string | null
        file_path: string
        file_deleted_at: number | null
        server_video_id: string | null
        server_video_key: string | null
        game: string
        started_at: number
        ended_at: number | null
      }
    | undefined

  if (!row) return null
  return {
    id: row.id,
    accountId: row.account_id,
    riotId: row.riot_id,
    serverKey: row.server_key,
    matchId: row.match_id,
    filePath: row.file_path,
    fileDeleted: row.file_deleted_at !== null,
    serverVideoId: row.server_video_id,
    serverVideoKey: row.server_video_key,
    game: row.game === 'tft' ? 'tft' : 'lol',
    startedAt: row.started_at,
    durationSeconds: row.ended_at === null ? null : Math.round((row.ended_at - row.started_at) / 1000)
  }
}

/**
 * The server said the recording's video is ready: what this PC knows of it
 * from then on, and what decides whether its file may go. Null clears it — the
 * server no longer has it.
 */
export function setServerCopy(
  db: DatabaseSync,
  recordingId: number,
  copy: { videoId: string; serverKey: string; at: number } | null
): void {
  db.prepare(
    'UPDATE recordings SET server_video_id = ?, server_video_key = ?, server_video_at = ? WHERE id = ?'
  ).run(copy?.videoId ?? null, copy?.serverKey ?? null, copy?.at ?? null, recordingId)
}

/**
 * The file is gone on purpose; the row stays because the recording is on the server.
 *
 * Not the same as the file going missing, which is still reported: this is a
 * recording whose video lives elsewhere now, and nothing is wrong with it.
 */
export function markFileDeleted(db: DatabaseSync, recordingId: number, at: number): void {
  db.prepare('UPDATE recordings SET file_deleted_at = ?, file_bytes = NULL WHERE id = ?').run(
    at,
    recordingId
  )
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

/** What a finished recording's place on disk is worked out from. See capture/recordingLayout.ts. */
export interface RecordingPlacementFacts {
  riotId: string | null
  game: GameId
  queueId: number | null
  startedAt: number
}

export function getRecordingPlacementFacts(db: DatabaseSync, recordingId: number): RecordingPlacementFacts | null {
  const row = db
    .prepare('SELECT riot_id, game, queue_id, started_at FROM recordings WHERE id = ?')
    .get(recordingId) as unknown as
    | { riot_id: string | null; game: string; queue_id: number | null; started_at: number }
    | undefined
  if (!row) return null
  return {
    riotId: row.riot_id,
    game: row.game === 'tft' ? 'tft' : 'lol',
    queueId: row.queue_id,
    startedAt: row.started_at
  }
}

/** Whether another recording already claims this file, which the UNIQUE on file_path would refuse. */
export function isRecordingPathTaken(db: DatabaseSync, filePath: string, exceptId: number): boolean {
  return (
    db.prepare('SELECT 1 FROM recordings WHERE file_path = ? AND id != ?').get(filePath, exceptId) !== undefined
  )
}

/** Points a recording at the file where it now is, after it was moved into place late. */
export function updateRecordingFilePath(db: DatabaseSync, recordingId: number, filePath: string): void {
  db.prepare('UPDATE recordings SET file_path = ? WHERE id = ?').run(filePath, recordingId)
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
  game: GameId
  /** TFT's: the client's id for the game, and the platform, which together are its match id. */
  gameId: number | null
  platformId: string | null
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
      `SELECT id, account_id, started_at, ended_at, roster_json, self_champion_id, game, game_id, platform_id
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
    game: string
    game_id: number | null
    platform_id: string | null
  }>

  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    roster: row.roster_json ? (JSON.parse(row.roster_json) as number[]) : [],
    selfChampionId: row.self_champion_id,
    game: row.game === 'tft' ? 'tft' : 'lol',
    gameId: row.game_id,
    platformId: row.platform_id
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

/** A recording that should have its file on this PC, and whether it does. */
interface RecordingFile {
  id: number
  bytes: number
  unmatched: boolean
  present: boolean
}

/**
 * Every finished recording that should have its file on this PC — whoever
 * played it — oldest first, and whether the file is there.
 *
 * The one set the disk figures and the cleanup are both read from, so the size
 * the tab warns about is made of exactly the files "Delete the oldest" can
 * reach. They used to disagree: the size was this PC's and the cleanup one
 * account's, and a PC full of another account's games warned about files the
 * button never touched.
 *
 * A file deleted on purpose is not one of them: the row says where it went,
 * and it takes up nothing. Nor is a recording still being written: it has no
 * size until it stops, and OBS has not told us its file's name yet.
 */
function recordingFiles(db: DatabaseSync): RecordingFile[] {
  const rows = db
    .prepare(
      `SELECT id, file_path, file_bytes, bind_state FROM recordings
        WHERE file_deleted_at IS NULL AND ended_at IS NOT NULL
        ORDER BY started_at ASC, id ASC`
    )
    .all() as unknown as Array<{ id: number; file_path: string; file_bytes: number | null; bind_state: string }>
  return rows.map((row) => ({
    id: row.id,
    bytes: row.file_bytes ?? 0,
    unmatched: row.bind_state === 'unmatched',
    present: existsSync(row.file_path)
  }))
}

export interface RecordingUsageRow {
  /** The files that are there, added up. */
  totalBytes: number
  count: number
  unmatchedCount: number
  /** Recordings whose file should be here and is not — moved or deleted outside the app. */
  missingCount: number
}

/** What the recordings take up on this disk, and how many of their files have gone missing. */
export function getRecordingUsage(db: DatabaseSync): RecordingUsageRow {
  const files = recordingFiles(db)
  const present = files.filter((file) => file.present)
  return {
    totalBytes: present.reduce((total, file) => total + file.bytes, 0),
    count: present.length,
    unmatchedCount: present.filter((file) => file.unmatched).length,
    missingCount: files.length - present.length
  }
}

/**
 * The N oldest recordings on this PC with their file still here — what the
 * cleanup button deletes, from the same files the size above it adds up. One
 * whose file is already gone frees nothing, so it is not one of the N.
 */
export function getOldestRecordingIds(db: DatabaseSync, count: number): number[] {
  return recordingFiles(db)
    .filter((file) => file.present)
    .slice(0, Math.max(0, count))
    .map((file) => file.id)
}

/**
 * Recordings whose file was deleted from this PC and whose video is on the
 * server: rows that keep nothing here but a line in the list. What "Forget
 * them" clears, and nothing else — a recording with its file still here is
 * never one of them.
 */
const SERVER_ONLY = 'file_deleted_at IS NOT NULL AND server_video_id IS NOT NULL'

export function countServerOnlyRecordings(db: DatabaseSync): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM recordings WHERE ${SERVER_ONLY}`).get() as { n: number }).n
}

export function getServerOnlyRecordingIds(db: DatabaseSync): number[] {
  const rows = db
    .prepare(`SELECT id FROM recordings WHERE ${SERVER_ONLY} ORDER BY started_at ASC, id ASC`)
    .all() as unknown as Array<{ id: number }>
  return rows.map((row) => row.id)
}

/**
 * Removes many rows in one transaction — their markers and uploads go with
 * them, by the foreign keys — and answers how many there were. An id with no
 * row is passed over.
 */
export function deleteRecordings(db: DatabaseSync, recordingIds: readonly number[]): number {
  if (recordingIds.length === 0) return 0
  const stmt = db.prepare('DELETE FROM recordings WHERE id = ?')
  let deleted = 0
  db.exec('BEGIN')
  try {
    for (const id of recordingIds) deleted += Number(stmt.run(id).changes)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return deleted
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
export function getRecordingArtefactsForMatches(
  db: DatabaseSync,
  account: AccountContext,
  matchIds: string[]
): Map<string, RecordingArtefact> {
  if (matchIds.length === 0) return new Map()

  const placeholders = matchIds.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT r.match_id, r.id, r.server_video_id, r.file_deleted_at,
              CASE WHEN u.state IN (${PENDING_UPLOAD_STATES}) THEN 1 ELSE 0 END AS pending
         FROM recordings r
         LEFT JOIN media_uploads u ON u.recording_id = r.id
        WHERE r.id IN (
              SELECT MAX(id) FROM recordings
               WHERE match_id IN (${placeholders})
                 AND ${ownedBy('account_id', 'riot_id')}
               GROUP BY match_id)`
    )
    .all(...matchIds, ...ownedByParams(account)) as unknown as Array<{
    match_id: string
    id: number
    server_video_id: string | null
    file_deleted_at: number | null
    pending: number
  }>

  return new Map(
    rows.map((row) => [
      row.match_id,
      {
        recordingId: row.id,
        onServer: row.server_video_id !== null,
        fileDeleted: row.file_deleted_at !== null,
        uploadPending: row.pending === 1
      }
    ])
  )
}

/** What a match row needs to know about this machine's recording of the game. */
export interface RecordingArtefact {
  recordingId: number
  /** The server said it has this recording ready. */
  onServer: boolean
  /** The file went from this PC after upload. */
  fileDeleted: boolean
  /** An upload is queued or under way, so the row does not offer another. */
  uploadPending: boolean
}

/**
 * Upload states that mean "on its way" — it will carry on by itself — as SQL.
 * The list is the shared rule's, so a query and the tab cannot disagree.
 */
export const PENDING_UPLOAD_STATES = PENDING_UPLOAD_STATES_SHARED.map((state) => `'${state}'`).join(', ')

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
