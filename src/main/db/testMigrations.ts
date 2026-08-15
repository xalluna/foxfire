import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Test-only migration runner.
 *
 * Imported solely by *.test.ts, so it never reaches the app bundle. Reads the
 * .sql files off disk rather than through Vite's `?raw` import, which keeps the
 * tests exercising exactly the SQL that ships without pulling in the renderer
 * plugin chain.
 *
 * Applies every migration it finds, in filename order, so adding one does not
 * mean editing each test's setup — the omission that otherwise surfaces as a
 * confusing "no such column" failure far from the actual change.
 */
const DIR = join(__dirname, 'migrations')

export function migrationSql(name: string): string {
  return readFileSync(join(DIR, name), 'utf8')
}

export function migrationNames(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

export function applyAllMigrations(db: DatabaseSync): void {
  for (const name of migrationNames()) db.exec(migrationSql(name))
}
