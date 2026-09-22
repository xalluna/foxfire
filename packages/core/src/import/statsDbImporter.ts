import type { ImportProgress, ImportResult } from '../types'
import { silentLogger, type Logger } from '../log'
import type {
  ImportAccountResult,
  ImportAccountRow,
  ImportMatchRow,
  ImportReadingRow,
  ImportSeasonRow
} from './rows'

/**
 * Moving an old stats.db into a server somebody administers.
 *
 * Somebody ran Foxfire on their own PC for a year and now hosts a server for
 * their friends. Everything in that file is worth keeping and none of it can be
 * copied straight across, because Riot encrypts a player id against the key
 * that asked for it: every id in that database is a value the server's Riot
 * will refuse.
 *
 * So the order here is not arbitrary. Accounts go first, because the server
 * re-resolves each one from its Riot ID and records what its old id used to
 * mean; everything after that is translated through those records. Matches
 * carry their own payloads, which is all the server needs — it already knows
 * how to turn one of those into rows. Readings are keyed on the dead ids and
 * find their account through the same mapping. The LP is not sent at all: it is
 * derived from the readings, and the server works it out once at the end rather
 * than importing a stale copy of its own conclusion.
 *
 * Nothing here opens the file, because opening it is the one part that differs
 * between the clients: the desktop reads it with node:sqlite straight off the
 * disk, and a browser loads it into sql.js from a file somebody picked. Either
 * way it is read and never written — it is somebody's only copy of their
 * history, and an import that corrupted it would be unforgivable for a feature
 * whose whole purpose is not losing it.
 */

/** A value SQLite can be handed as a bind parameter. */
export type SqlParam = string | number | null

/**
 * Read access to an open stats.db.
 *
 * Either synchronous or not, because node:sqlite is and sql.js need not be, and
 * the importer awaits every call either way.
 */
export interface SqliteReader {
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): T[] | Promise<T[]>
  get<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParam[]
  ): T | undefined | Promise<T | undefined>
}

/** Where the rows go: the server's import endpoints, in the order they have to be called. */
export interface ImportTarget {
  accounts(rows: ImportAccountRow[]): Promise<ImportAccountResult[]>
  seasons(rows: ImportSeasonRow[]): Promise<{ accepted: number }>
  matches(rows: ImportMatchRow[]): Promise<{ accepted: number }>
  rankReadings(rows: ImportReadingRow[]): Promise<{ accepted: number }>
  finish(): Promise<{ accounts: number; attributed: number }>
}

/**
 * How many rows go in one request.
 *
 * Matches dominate: at 100–200 KB of payload each this is a request of a few
 * megabytes, which is enough that a year of history is a few dozen calls rather
 * than thousands, and small enough that a failure costs a page. The server
 * enforces the same number.
 */
export const IMPORT_BATCH = 100

/**
 * Reads a stats.db and pushes it at a server.
 *
 * Progress is reported rather than returned, because the whole run is minutes
 * — a Riot lookup per account and a page of matches per request — and a
 * settings panel that sat on one promise would have nothing to say for all of
 * it.
 *
 * Never throws. A run that cannot finish answers with why, because the panel
 * that started it has a person waiting on the answer.
 */
export async function importStatsDb(
  reader: SqliteReader,
  target: ImportTarget,
  onProgress: (progress: ImportProgress) => void,
  options: { log?: Logger } = {}
): Promise<ImportResult> {
  const log = options.log ?? silentLogger

  try {
    return await run(reader, target, onProgress, log)
  } catch (err) {
    log.error('Import failed', err)
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'The import could not be completed.',
      ...emptyImport()
    }
  }
}

async function run(
  db: SqliteReader,
  target: ImportTarget,
  report: (progress: ImportProgress) => void,
  log: Logger
): Promise<ImportResult> {
  if (!(await hasTable(db, 'accounts')) || !(await hasTable(db, 'matches'))) {
    return {
      ok: false,
      message: 'That database has no Foxfire tables in it.',
      ...emptyImport()
    }
  }

  const result = { accounts: 0, matches: 0, readings: 0, seasons: 0, unresolved: [] as string[] }

  // ── Accounts, first and alone ───────────────────────────────────────────────
  //
  // Everything after this is translated through what the server records here,
  // so a failure at this step is a reason to stop rather than to carry on with
  // rows nothing can place.

  const accounts = await db.all<{
    puuid: string
    game_name: string
    tag_line: string
    platform: string | null
  }>('SELECT puuid, game_name, tag_line, platform FROM accounts ORDER BY id')

  report({ phase: 'accounts', current: 0, total: accounts.length })

  for (const page of pages(accounts)) {
    const resolved = await target.accounts(
      page.map((row) => ({
        gameName: row.game_name,
        tagLine: row.tag_line,
        platform: row.platform,
        puuid: row.puuid
      }))
    )

    for (const one of resolved) {
      if (one.resolved) result.accounts += 1
      else result.unresolved.push(one.riotId)
    }

    report({
      phase: 'accounts',
      current: result.accounts + result.unresolved.length,
      total: accounts.length
    })
  }

  // ── Seasons, before anything that depends on them ──────────────────────────
  //
  // Attribution skips a ladder reset, so a boundary that arrived after the
  // readings would mean the final pass attributed across one.

  if (await hasTable(db, 'seasons')) {
    const seasons = await db.all<{
      label: string
      starts_at: number
      is_preseason: number
      resets_rank: number
    }>('SELECT label, starts_at, is_preseason, resets_rank FROM seasons ORDER BY starts_at')

    if (seasons.length > 0) {
      const batch = await target.seasons(
        seasons.map((row) => ({
          label: row.label,
          startsAt: row.starts_at,
          isPreseason: row.is_preseason === 1,
          resetsRank: row.resets_rank === 1
        }))
      )

      result.seasons = batch.accepted
    }
  }

  // ── Matches, as the payloads they already are ──────────────────────────────

  const matchCount = await count(db, 'matches')
  report({ phase: 'matches', current: 0, total: matchCount })

  let offset = 0
  while (offset < matchCount) {
    const rows = await db.all<{ match_id: string; raw_json: string }>(
      'SELECT match_id, raw_json FROM matches ORDER BY game_creation LIMIT ? OFFSET ?',
      [IMPORT_BATCH, offset]
    )

    if (rows.length === 0) break

    const batch = await target.matches(
      rows.map((row) => ({ matchId: row.match_id, rawJson: row.raw_json }))
    )

    result.matches += batch.accepted
    offset += rows.length

    report({ phase: 'matches', current: offset, total: matchCount })
  }

  // ── Rank readings, keyed on ids nothing can decrypt ────────────────────────
  //
  // Joined to accounts here rather than sent as an account id, because the
  // server has no idea what this file's integer ids meant. The puuid is the
  // handle it recorded a translation for.

  if (await hasTable(db, 'rank_snapshots')) {
    const readingCount = await count(db, 'rank_snapshots')
    report({ phase: 'readings', current: 0, total: readingCount })

    let read = 0
    while (read < readingCount) {
      const rows = await db.all<{
        puuid: string
        queue_type: string
        tier: string | null
        rank: string | null
        league_points: number | null
        wins: number | null
        losses: number | null
        source: string
        captured_at: number
        match_id: string | null
      }>(
        `SELECT a.puuid AS puuid, s.queue_type, s.tier, s.rank, s.league_points,
                s.wins, s.losses, s.source, s.captured_at, s.match_id
           FROM rank_snapshots s
           JOIN accounts a ON a.id = s.account_id
          ORDER BY s.captured_at, s.id
          LIMIT ? OFFSET ?`,
        [IMPORT_BATCH, read]
      )

      if (rows.length === 0) break

      const batch = await target.rankReadings(
        rows.map((row) => ({
          puuid: row.puuid,
          queueType: row.queue_type,
          tier: row.tier,
          division: row.rank,
          leaguePoints: row.league_points,
          wins: row.wins,
          losses: row.losses,
          source: row.source,
          capturedAt: row.captured_at,
          matchId: row.match_id
        }))
      )

      result.readings += batch.accepted
      read += rows.length

      report({ phase: 'readings', current: read, total: readingCount })
    }
  }

  // ── And the LP, worked out rather than carried over ────────────────────────

  report({ phase: 'finishing', current: 0, total: 0 })

  const summary = await target.finish()

  report({ phase: 'done', current: 0, total: 0 })

  log.info('Imported a stats.db', {
    accounts: result.accounts,
    matches: result.matches,
    readings: result.readings,
    attributed: summary.attributed
  })

  return {
    ok: true,
    message: null,
    accounts: result.accounts,
    matches: result.matches,
    readings: result.readings,
    seasons: result.seasons,
    attributed: summary.attributed,
    unresolved: result.unresolved
  }
}

async function hasTable(db: SqliteReader, name: string): Promise<boolean> {
  const row = await db.get("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?", [
    name
  ])

  return row !== undefined
}

async function count(db: SqliteReader, table: string): Promise<number> {
  // The table name is not user input — it is one of a handful of literals in
  // this file — which is why it can be interpolated at all. A bind parameter
  // cannot name a table.
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
  return Number(row?.n ?? 0)
}

function* pages<T>(rows: readonly T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += IMPORT_BATCH) yield rows.slice(i, i + IMPORT_BATCH)
}

/** The tally of an import that did nothing, for the answers that explain why. */
export function emptyImport(): Omit<ImportResult, 'ok' | 'message'> {
  return { accounts: 0, matches: 0, readings: 0, seasons: 0, attributed: 0, unresolved: [] }
}
