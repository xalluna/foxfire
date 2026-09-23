import type { ImportProgress, ImportResult } from '../types'
import { silentLogger, type Logger } from '../log'
import type {
  ImportAccountResult,
  ImportAccountRow,
  ImportBatchOutcome,
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
 * The same file can be imported again, and that is the ordinary way to keep a
 * server current: keep using Foxfire on your own PC for a few days, send the
 * newer copy, and what lands is what is new. Every batch the server receives
 * skips what it already holds, so that is correct by itself; what makes it
 * cheap is asking first. The matches are 100–200 KB each and the ids are a few
 * bytes, so the file's game ids go up before any payload does and only the ones
 * the server lacks are sent. A server too old to be asked is sent everything,
 * which costs time and nothing else.
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
  seasons(rows: ImportSeasonRow[]): Promise<ImportBatchOutcome>
  /**
   * Which of these game ids the server has never stored, or null when it cannot
   * say — a server older than the question. Null is not a failure: it means
   * send everything, and the matches batch skips what is already there.
   */
  unstoredMatches(matchIds: string[]): Promise<string[] | null>
  matches(rows: ImportMatchRow[]): Promise<ImportBatchOutcome>
  rankReadings(rows: ImportReadingRow[]): Promise<ImportBatchOutcome>
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
 * How many game ids are asked about in one request.
 *
 * Far more than a page of payloads, because an id is a few bytes where a payload
 * is a few hundred kilobytes: a thousand is a request about the size of one
 * match. The server enforces the same number.
 */
export const IMPORT_ID_PAGE = 1000

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

  const result = {
    ...emptyImport(),
    newest: await newestInFile(db)
  }

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

      result.healed += one.healedMatches ?? 0
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
      result.alreadyThere.seasons = batch.skipped
    }
  }

  // ── Matches, as the payloads they already are ──────────────────────────────
  //
  // Ids first, then only the payloads the server does not have. The ids are read
  // on their own and in a fixed order — game creation and then the id, because
  // two games can start in the same millisecond and a page boundary between
  // them would otherwise be decided by whatever order the file happens to
  // return ties in.

  const ids = (
    await db.all<{ match_id: string }>(
      'SELECT match_id FROM matches ORDER BY game_creation, match_id'
    )
  ).map((row) => row.match_id)

  const wanted = await unstoredIds(ids, target, report)
  result.alreadyThere.matches = ids.length - wanted.length

  report({ phase: 'matches', current: 0, total: wanted.length })

  let sent = 0
  for (const page of pages(wanted)) {
    const rows = await db.all<{ match_id: string; raw_json: string }>(
      `SELECT match_id, raw_json FROM matches
        WHERE match_id IN (${page.map(() => '?').join(', ')})
        ORDER BY game_creation, match_id`,
      page
    )

    const batch = await target.matches(
      rows.map((row) => ({ matchId: row.match_id, rawJson: row.raw_json }))
    )

    result.matches += batch.accepted
    result.alreadyThere.matches += batch.skipped
    result.matchesFailed += batch.failed
    sent += page.length

    report({ phase: 'matches', current: sent, total: wanted.length })
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
      result.alreadyThere.readings += batch.skipped
      result.readingsUnplaced += batch.unplaced
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
    alreadyThere: result.alreadyThere,
    matchesFailed: result.matchesFailed,
    readingsUnplaced: result.readingsUnplaced,
    healed: result.healed,
    attributed: summary.attributed
  })

  return {
    ...result,
    ok: true,
    message: null,
    attributed: summary.attributed
  }
}

/**
 * Which of the file's games are worth sending.
 *
 * Asks in pages of ids. A server that cannot be asked — one older than the
 * question — answers null and everything is sent, which is the same result
 * arrived at the slow way.
 */
async function unstoredIds(
  ids: readonly string[],
  target: ImportTarget,
  report: (progress: ImportProgress) => void
): Promise<string[]> {
  report({ phase: 'comparing', current: 0, total: ids.length })

  const missing = new Set<string>()
  let asked = 0

  for (let i = 0; i < ids.length; i += IMPORT_ID_PAGE) {
    const page = ids.slice(i, i + IMPORT_ID_PAGE)
    const answer = await target.unstoredMatches(page)
    if (answer === null) return [...ids]

    for (const id of answer) missing.add(id)

    asked += page.length
    report({ phase: 'comparing', current: asked, total: ids.length })
  }

  // In the file's order rather than the server's, so the payloads go up oldest
  // first exactly as they did before anybody asked.
  return ids.filter((id) => missing.has(id))
}

/**
 * The newest game and reading in the file, so a run can say what it was given.
 *
 * A run that added nothing is either finished or was handed a file that stops
 * where the last import did — the second is what reading a database without its
 * write-ahead log looks like, and only the file can say which.
 */
async function newestInFile(
  db: SqliteReader
): Promise<{ matchAt: number | null; readingAt: number | null }> {
  const newest = async (table: string, column: string): Promise<number | null> => {
    if (!(await hasTable(db, table))) return null

    // Interpolated for the same reason `count` does it: both are literals in
    // this file, and a bind parameter cannot name a table.
    const row = await db.get<{ newest: number | null }>(`SELECT MAX(${column}) AS newest FROM ${table}`)
    return row?.newest == null ? null : Number(row.newest)
  }

  return {
    matchAt: await newest('matches', 'game_creation'),
    readingAt: await newest('rank_snapshots', 'captured_at')
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
  return {
    accounts: 0,
    matches: 0,
    readings: 0,
    seasons: 0,
    attributed: 0,
    unresolved: [],
    alreadyThere: { matches: 0, readings: 0, seasons: 0 },
    matchesFailed: 0,
    readingsUnplaced: 0,
    healed: 0,
    newest: { matchAt: null, readingAt: null }
  }
}
