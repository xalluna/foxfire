import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { LinkedMatchInfo, Replay } from '@shared/types'

/** What is known about a replay the moment it is ingested. */
export interface NewReplay {
  matchId: string | null
  accountId: number | null
  filePath: string
  sourcePath: string | null
  fileBytes: number | null
  gameVersion: string | null
  patch: string | null
  durationSeconds: number | null
  recordedAt: number
}

interface ReplayRow {
  id: number
  account_id: number | null
  match_id: string | null
  file_path: string
  source_path: string | null
  file_bytes: number | null
  game_version: string | null
  patch: string | null
  duration_seconds: number | null
  recorded_at: number
  // All null unless the match has synced and the owning account is known.
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
 * The linked match, joined rather than bound.
 *
 * This LEFT JOIN is the whole binding story for replays. match_id is derived
 * from Riot's filename at ingest, so the link exists before the match does; the
 * join simply starts returning rows the moment sync lands the game. Nothing has
 * to notice, and nothing can be left stale by a sync that never ran.
 *
 * The participant join needs an account to know whose scoreboard to report, so
 * it produces nothing while account_id is null — which is exactly the "not
 * linked to a match" row the Replays tab draws.
 */
const SELECT_REPLAY = `
  SELECT r.id, r.account_id, r.match_id, r.file_path, r.source_path, r.file_bytes,
         r.game_version, r.patch, r.duration_seconds, r.recorded_at,
         m.game_creation AS m_game_creation, m.game_duration AS m_game_duration,
         m.game_mode AS m_game_mode, m.queue_id AS m_queue_id,
         p.win AS m_win, p.champion_id AS m_champion_id, p.champion_name AS m_champion_name,
         p.kills AS m_kills, p.deaths AS m_deaths, p.assists AS m_assists
    FROM replays r
    LEFT JOIN matches m ON m.match_id = r.match_id
    LEFT JOIN match_participants p
      ON p.match_id = r.match_id
     AND p.puuid = (SELECT puuid FROM accounts WHERE id = r.account_id)`

function toMatch(row: ReplayRow): LinkedMatchInfo | null {
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

/**
 * blockedReason is left null here and filled in by the service.
 *
 * Whether a replay can be watched depends on which clients are installed right
 * now, which is not a database question — the repository would have to be told
 * the answer in order to report it, and would then be handing the caller its
 * own input back.
 */
function toReplay(row: ReplayRow): Replay {
  return {
    id: row.id,
    accountId: row.account_id,
    matchId: row.match_id,
    fileExists: existsSync(row.file_path),
    fileBytes: row.file_bytes,
    gameVersion: row.game_version,
    patch: row.patch,
    durationSeconds: row.duration_seconds,
    recordedAt: row.recorded_at,
    match: toMatch(row),
    blockedReason: null
  }
}

export function createReplay(db: DatabaseSync, input: NewReplay): number {
  db.prepare(
    `INSERT INTO replays
       (match_id, account_id, file_path, source_path, file_bytes,
        game_version, patch, duration_seconds, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.matchId,
    input.accountId,
    input.filePath,
    input.sourcePath,
    input.fileBytes,
    input.gameVersion,
    input.patch,
    input.durationSeconds,
    input.recordedAt
  )

  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
  return row.id
}

/**
 * Every live replay for one account, plus the ones we cannot place yet.
 *
 * Unowned replays appear under whichever account is looking. They are the ones
 * whose match has not synced, and hiding them until it does would mean a replay
 * that exists on disk is unreachable from inside the app — the same failure the
 * Recordings tab exists to prevent.
 */
export function getReplays(db: DatabaseSync, accountId: number): Replay[] {
  const rows = db
    .prepare(
      `${SELECT_REPLAY}
        WHERE r.deleted_at IS NULL
          AND (r.account_id = ? OR r.account_id IS NULL)
        ORDER BY r.recorded_at DESC`
    )
    .all(accountId) as unknown as ReplayRow[]

  return rows.map(toReplay)
}

export function getReplay(db: DatabaseSync, id: number): Replay | null {
  const row = db.prepare(`${SELECT_REPLAY} WHERE r.id = ?`).get(id) as unknown as
    | ReplayRow
    | undefined
  return row === undefined ? null : toReplay(row)
}

/** The absolute path of Foxfire's copy. The renderer never learns one. */
export function getReplayFilePath(db: DatabaseSync, id: number): string | null {
  const row = db
    .prepare('SELECT file_path FROM replays WHERE id = ? AND deleted_at IS NULL')
    .get(id) as { file_path: string } | undefined
  return row?.file_path ?? null
}

/**
 * Every source path already accounted for, tombstones included.
 *
 * The tombstones are the point: a soft-deleted replay must stay in this set or
 * the next folder scan imports the file the user just removed all over again.
 */
export function getKnownSourcePaths(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT source_path FROM replays WHERE source_path IS NOT NULL')
    .all() as unknown as Array<{ source_path: string }>

  // Lower-cased because Windows paths are case-insensitive, and one folder
  // reached by two spellings must not import twice.
  return new Set(rows.map((row) => row.source_path.toLowerCase()))
}

/** Match ids already claimed, so one pass cannot hand the same game to two files. */
export function getClaimedMatchIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare('SELECT match_id FROM replays WHERE match_id IS NOT NULL AND deleted_at IS NULL')
    .all() as unknown as Array<{ match_id: string }>
  return new Set(rows.map((row) => row.match_id))
}

/**
 * Replays still waiting to learn whose they are.
 *
 * A replay knows its match id from the filename long before that match syncs,
 * and only the match says which account played it. So ownership is resolved on
 * a later pass, after sync, for every row still missing it.
 */
export function getUnownedReplays(db: DatabaseSync): Array<{ id: number; matchId: string }> {
  return db
    .prepare(
      `SELECT id, match_id AS matchId
         FROM replays
        WHERE account_id IS NULL AND match_id IS NOT NULL AND deleted_at IS NULL`
    )
    .all() as unknown as Array<{ id: number; matchId: string }>
}

export function setReplayAccount(db: DatabaseSync, id: number, accountId: number): void {
  db.prepare('UPDATE replays SET account_id = ? WHERE id = ?').run(accountId, id)
}

export function setReplayMatch(db: DatabaseSync, id: number, matchId: string): void {
  db.prepare('UPDATE replays SET match_id = ? WHERE id = ?').run(matchId, id)
}

/**
 * Soft delete.
 *
 * The row stays so the watcher remembers this file was let go on purpose.
 * Clearing file_path would be tidier and would also throw away the only record
 * of what was removed, so it is kept and simply stops being selected.
 */
export function softDeleteReplay(db: DatabaseSync, id: number, now: number): void {
  db.prepare('UPDATE replays SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, id)
}

export function getUsage(
  db: DatabaseSync,
  accountId: number
): { totalBytes: number; count: number; unlinkedCount: number } {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(file_bytes), 0) AS totalBytes,
              COUNT(*) AS count,
              SUM(CASE WHEN match_id IS NULL THEN 1 ELSE 0 END) AS unlinkedCount
         FROM replays
        WHERE deleted_at IS NULL AND (account_id = ? OR account_id IS NULL)`
    )
    .get(accountId) as { totalBytes: number; count: number; unlinkedCount: number | null }

  return { ...row, unlinkedCount: row.unlinkedCount ?? 0 }
}
