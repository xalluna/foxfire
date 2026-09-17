import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import telemetrySql from './migrations/001_telemetry.sql?raw'

/**
 * Connection to telemetry.db, deliberately separate from the app's stats.db.
 *
 * Mirrors db/index.ts — same singleton, same schema_migrations table, same
 * Vite `?raw` inlining so migrations work identically in dev and packaged —
 * with two deliberate differences:
 *
 *   - Opened lazily. Telemetry is off by default, and a user who never turns it
 *     on should never get the file created.
 *   - `synchronous = NORMAL` rather than SQLite's default FULL. Losing the last
 *     few milliseconds of telemetry to a hard power cut costs nothing, and
 *     every fsync avoided is one less blocking moment on the main thread.
 */
let db: DatabaseSync | null = null

const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: '001_telemetry.sql', sql: telemetrySql }
]

function applyMigrations(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  const applied = new Set(
    database
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => (row as { name: string }).name)
  )

  const insert = database.prepare('INSERT INTO schema_migrations (name) VALUES (?)')

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue
    database.exec('BEGIN')
    try {
      database.exec(migration.sql)
      insert.run(migration.name)
      database.exec('COMMIT')
    } catch (err) {
      database.exec('ROLLBACK')
      throw err
    }
  }
}

export function telemetryDbPath(): string {
  return join(app.getPath('userData'), 'data', 'telemetry.db')
}

/**
 * Opens the database, creating and migrating it on first use.
 *
 * Called both when collection is enabled and when the panel reads history, so
 * that turning collection *off* still leaves past data readable rather than
 * closing the file out from under the UI.
 */
export function openTelemetryDb(): DatabaseSync {
  if (db) return db

  const dir = join(app.getPath('userData'), 'data')
  mkdirSync(dir, { recursive: true })

  db = new DatabaseSync(telemetryDbPath(), { timeout: 5_000 })
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  applyMigrations(db)
  return db
}

/** The open handle, or null if telemetry has never been enabled this session. */
export function peekTelemetryDb(): DatabaseSync | null {
  return db
}

export function closeTelemetryDb(): void {
  db?.close()
  db = null
}

// Re-exported so callers that already hold the connection have one import.
export { getMeta, setMeta } from './meta'
