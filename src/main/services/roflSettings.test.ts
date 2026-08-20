import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyAllMigrations } from '../db/testMigrations'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const live = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../db', () => ({ getDb: () => live.db }))
vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\you\\Videos' } }))
vi.mock('./captureSettings', () => ({
  getCaptureSettings: () => ({ folder: 'C:\\Users\\you\\Videos\\Foxfire' })
}))

const { getRoflSettings, setRoflSettings, defaultSourceFolders } = await import('./roflSettings')

beforeEach(() => {
  const db = new DatabaseSync(':memory:')
  applyAllMigrations(db)
  live.db = db
})

afterEach(() => {
  const db = live.db as DatabaseSyncType
  db.close()
})

describe('getRoflSettings', () => {
  /**
   * This is a regression test for a bug that shipped and did nothing visible.
   *
   * getBoolSetting resolves an unset key to its fallback and returns a plain
   * boolean, so writing `getBoolSetting(db, key) ?? true` reads exactly like a
   * default and silently yields `false`. The feature then switched itself off
   * on every fresh install, and the scan returned without a word.
   */
  it('keeps replays by default on a fresh install', () => {
    expect(getRoflSettings().enabled).toBe(true)
  })

  it('still lets the setting be turned off and back on', () => {
    expect(setRoflSettings({ enabled: false }).enabled).toBe(false)
    expect(getRoflSettings().enabled).toBe(false)
    expect(setRoflSettings({ enabled: true }).enabled).toBe(true)
  })

  it('treats an empty override as no override', () => {
    setRoflSettings({ sourceFolder: '   ' })
    expect(getRoflSettings().sourceFolder).toBeNull()
  })

  it('keeps its own copies beside the recordings', () => {
    expect(getRoflSettings().folder).toBe('C:\\Users\\you\\Videos\\Foxfire\\Replays')
  })

  it('rejects a negative cap rather than storing one', () => {
    expect(setRoflSettings({ softCapBytes: -5 }).softCapBytes).toBe(0)
  })
})

describe('defaultSourceFolders', () => {
  // Both spellings, because a machine with OneDrive set up has both and the
  // fallback reads either.
  const KEYS = ['OneDrive', 'OneDriveConsumer'] as const
  const saved = KEYS.map((key) => [key, process.env[key]] as const)

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('offers the OneDrive location too, because Documents is often redirected', () => {
    process.env['OneDrive'] = 'C:\\Users\\you\\OneDrive'
    const folders = defaultSourceFolders()

    expect(folders).toHaveLength(2)
    expect(folders[1]).toBe('C:\\Users\\you\\OneDrive\\Documents\\League of Legends\\Replays')
  })

  it('offers only the plain location when OneDrive is not configured', () => {
    for (const key of KEYS) delete process.env[key]
    expect(defaultSourceFolders()).toHaveLength(1)
  })
})
