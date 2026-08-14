import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import initSql from './migrations/001_init.sql?raw'

let db: DatabaseSync | null = null

// Inlined at build time via Vite's ?raw import so migrations work identically
// in dev and in the packaged app with no file copying.
const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: '001_init.sql', sql: initSql }
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

export function initDatabase(): DatabaseSync {
  if (db) return db

  const dir = join(app.getPath('userData'), 'data')
  mkdirSync(dir, { recursive: true })

  db = new DatabaseSync(join(dir, 'stats.db'), {
    enableForeignKeyConstraints: true,
    timeout: 5_000
  })
  db.exec('PRAGMA journal_mode = WAL')
  applyMigrations(db)
  return db
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized — call initDatabase() first')
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}
