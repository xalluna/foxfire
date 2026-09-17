import type { DatabaseSync } from 'node:sqlite'

/**
 * The telemetry_meta key/value table.
 *
 * Its own module, importing `node:sqlite` as a type only, so the writer and the
 * retention job can use it without pulling in db.ts — which imports
 * DatabaseSync as a value and, per the note in matches.repo.test.ts, cannot be
 * loaded from a test because Vite strips the `node:` prefix and then fails to
 * resolve a bare `sqlite`.
 */

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM telemetry_meta WHERE key = ?').get(key) as unknown as
    | { value: string | null }
    | undefined
  return row?.value ?? null
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO telemetry_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}
