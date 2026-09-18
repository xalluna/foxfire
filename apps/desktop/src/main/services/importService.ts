import { DatabaseSync } from 'node:sqlite'
import { dialog } from 'electron'
import { authedRequest } from './serverService'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import type { ImportProgress, ImportResult } from '@shared/types'

const log = createLogger('import')

/**
 * Moving an old stats.db into the server this machine administers.
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
 * Read-only, and the file is never modified. It is somebody's only copy of
 * their history, and an import that corrupted it would be unforgivable for a
 * feature whose whole purpose is not losing it.
 */

/**
 * How many rows go in one request.
 *
 * Matches dominate: at 100–200 KB of payload each this is a request of a few
 * megabytes, which is enough that a year of history is a few dozen calls rather
 * than thousands, and small enough that a failure costs a page. The server
 * enforces the same number.
 */
const BATCH = 100

/** Asks for the file. Returns null when the dialog was dismissed. */
export async function chooseImportDatabase(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a Foxfire database to import',
    properties: ['openFile'],
    filters: [
      { name: 'Foxfire database', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })

  return result.canceled ? null : (result.filePaths[0] ?? null)
}

/**
 * Reads a stats.db and pushes it at the active server.
 *
 * Progress is broadcast rather than returned, because the whole run is minutes
 * — a Riot lookup per account and a page of matches per request — and a
 * settings panel that sat on one promise would have nothing to say for all of
 * it.
 */
export async function importDatabase(filePath: string): Promise<ImportResult> {
  let db: DatabaseSync

  try {
    // Read-only, and never modified. This is somebody's only copy of their
    // history, and an import that corrupted it would be unforgivable for a
    // feature whose whole purpose is not losing it.
    db = new DatabaseSync(filePath, { readOnly: true })
  } catch {
    return { ok: false, message: 'That file could not be opened as a Foxfire database.', ...empty() }
  }

  try {
    return await run(db)
  } catch (err) {
    log.error('Import failed', err)
    return {
      ok: false,
      message: err instanceof Error ? err.message : 'The import could not be completed.',
      ...empty()
    }
  } finally {
    db.close()
  }
}

async function run(db: DatabaseSync): Promise<ImportResult> {
  if (!hasTable(db, 'accounts') || !hasTable(db, 'matches')) {
    return {
      ok: false,
      message: 'That database has no Foxfire tables in it.',
      ...empty()
    }
  }

  const result = { accounts: 0, matches: 0, readings: 0, seasons: 0, unresolved: [] as string[] }

  // ── Accounts, first and alone ───────────────────────────────────────────────
  //
  // Everything after this is translated through what the server records here,
  // so a failure at this step is a reason to stop rather than to carry on with
  // rows nothing can place.

  const accounts = db
    .prepare('SELECT puuid, game_name, tag_line, platform FROM accounts ORDER BY id')
    .all() as unknown as Array<{
    puuid: string
    game_name: string
    tag_line: string
    platform: string | null
  }>

  report({ phase: 'accounts', current: 0, total: accounts.length })

  for (const page of pages(accounts)) {
    const resolved = await authedRequest<
      Array<{ riotId: string; accountId: string | null; resolved: boolean; message: string | null }>
    >('/admin/import/accounts', {
      method: 'POST',
      body: page.map((row) => ({
        gameName: row.game_name,
        tagLine: row.tag_line,
        platform: row.platform,
        puuid: row.puuid
      }))
    })

    for (const one of resolved) {
      if (one.resolved) result.accounts += 1
      else result.unresolved.push(one.riotId)
    }

    report({ phase: 'accounts', current: result.accounts + result.unresolved.length, total: accounts.length })
  }

  // ── Seasons, before anything that depends on them ──────────────────────────
  //
  // Attribution skips a ladder reset, so a boundary that arrived after the
  // readings would mean the final pass attributed across one.

  if (hasTable(db, 'seasons')) {
    const seasons = db
      .prepare('SELECT label, starts_at, is_preseason, resets_rank FROM seasons ORDER BY starts_at')
      .all() as unknown as Array<{
      label: string
      starts_at: number
      is_preseason: number
      resets_rank: number
    }>

    if (seasons.length > 0) {
      const batch = await authedRequest<{ accepted: number }>('/admin/import/seasons', {
        method: 'POST',
        body: seasons.map((row) => ({
          label: row.label,
          startsAt: row.starts_at,
          isPreseason: row.is_preseason === 1,
          resetsRank: row.resets_rank === 1
        }))
      })

      result.seasons = batch.accepted
    }
  }

  // ── Matches, as the payloads they already are ──────────────────────────────

  const matchCount = count(db, 'matches')
  report({ phase: 'matches', current: 0, total: matchCount })

  let offset = 0
  while (offset < matchCount) {
    const rows = db
      .prepare('SELECT match_id, raw_json FROM matches ORDER BY game_creation LIMIT ? OFFSET ?')
      .all(BATCH, offset) as unknown as Array<{ match_id: string; raw_json: string }>

    if (rows.length === 0) break

    const batch = await authedRequest<{ accepted: number }>('/admin/import/matches', {
      method: 'POST',
      body: rows.map((row) => ({ matchId: row.match_id, rawJson: row.raw_json }))
    })

    result.matches += batch.accepted
    offset += rows.length

    report({ phase: 'matches', current: offset, total: matchCount })
  }

  // ── Rank readings, keyed on ids nothing can decrypt ────────────────────────
  //
  // Joined to accounts here rather than sent as an account id, because the
  // server has no idea what this file's integer ids meant. The puuid is the
  // handle it recorded a translation for.

  if (hasTable(db, 'rank_snapshots')) {
    const readingCount = count(db, 'rank_snapshots')
    report({ phase: 'readings', current: 0, total: readingCount })

    let read = 0
    while (read < readingCount) {
      const rows = db
        .prepare(
          `SELECT a.puuid AS puuid, s.queue_type, s.tier, s.rank, s.league_points,
                  s.wins, s.losses, s.source, s.captured_at, s.match_id
             FROM rank_snapshots s
             JOIN accounts a ON a.id = s.account_id
            ORDER BY s.captured_at, s.id
            LIMIT ? OFFSET ?`
        )
        .all(BATCH, read) as unknown as Array<{
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
      }>

      if (rows.length === 0) break

      const batch = await authedRequest<{ accepted: number }>('/admin/import/rank-readings', {
        method: 'POST',
        body: rows.map((row) => ({
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
      })

      result.readings += batch.accepted
      read += rows.length

      report({ phase: 'readings', current: read, total: readingCount })
    }
  }

  // ── And the LP, worked out rather than carried over ────────────────────────

  report({ phase: 'finishing', current: 0, total: 0 })

  const summary = await authedRequest<{ accounts: number; attributed: number }>(
    '/admin/import/finish',
    { method: 'POST' }
  )

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

function report(progress: ImportProgress): void {
  broadcast(CH.serverAdmin.importProgress, progress)
}

function hasTable(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)

  return row !== undefined
}

function count(db: DatabaseSync, table: string): number {
  // The table name is not user input — it is one of a handful of literals in
  // this file — which is why it can be interpolated at all. A bind parameter
  // cannot name a table.
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as { n: number }
  return row.n
}

function* pages<T>(rows: readonly T[]): Generator<T[]> {
  for (let i = 0; i < rows.length; i += BATCH) yield rows.slice(i, i + BATCH)
}

function empty(): Omit<ImportResult, 'ok' | 'message'> {
  return { accounts: 0, matches: 0, readings: 0, seasons: 0, attributed: 0, unresolved: [] }
}
