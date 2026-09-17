import type { DatabaseSync } from 'node:sqlite'

/**
 * The generic key/value store created in 001 and unused until now.
 *
 * Holds preferences that are not secrets and not per-account — the LCU install
 * path override and the start-with-Windows flag. Secrets stay in
 * security/keyStore.ts, which encrypts them via Electron's safeStorage.
 */
export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as unknown as
    | { value: string | null }
    | undefined
  return row?.value ?? null
}

export function setSetting(db: DatabaseSync, key: string, value: string | null): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
}

export function getBoolSetting(db: DatabaseSync, key: string, fallback = false): boolean {
  const raw = getSetting(db, key)
  return raw === null ? fallback : raw === '1'
}

export function setBoolSetting(db: DatabaseSync, key: string, value: boolean): void {
  setSetting(db, key, value ? '1' : '0')
}
