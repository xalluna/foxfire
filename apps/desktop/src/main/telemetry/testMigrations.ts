import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Test-only migration runner for telemetry.db.
 *
 * Mirrors db/testMigrations.ts: reads the .sql off disk rather than through
 * Vite's `?raw` import, so tests exercise exactly the SQL that ships without
 * dragging in the plugin chain, and applies every file it finds in filename
 * order so adding a migration does not mean editing each test's setup.
 */
const DIR = join(__dirname, 'migrations')

export function applyTelemetryMigrations(db: DatabaseSync): void {
  const names = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const name of names) db.exec(readFileSync(join(DIR, name), 'utf8'))
}
