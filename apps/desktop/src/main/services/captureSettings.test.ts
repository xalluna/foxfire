import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyAllMigrations } from '../db/testMigrations'
import { getSetting, setBoolSetting, setSetting } from '../db/repositories/appSettings.repo'

/**
 * Which recorder an install is on, the update that added native recording
 * included. Somebody who set OBS up must still be on OBS after it; somebody
 * who never set capture up starts on native.
 */

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const state = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\me\\Videos' } }))
vi.mock('../db', () => ({ getDb: () => state.db }))
vi.mock('../security/keyStore', () => ({
  hasSecret: () => false,
  loadSecret: () => null,
  saveSecret: () => {},
  clearSecret: () => {}
}))

const { getCaptureSettings, pinCaptureDriver, setCaptureSettings } = await import('./captureSettings')

let db: DatabaseSyncType

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  applyAllMigrations(db)
  state.db = db
})

describe('the recorder an install uses', () => {
  it('is native on an install that never set capture up', () => {
    pinCaptureDriver()

    expect(getSetting(db, 'capture.driver')).toBeNull()
    expect(getCaptureSettings().driver).toBe('native')
  })

  it('stays OBS on an install that already records with it', () => {
    setBoolSetting(db, 'capture.enabled', true)

    pinCaptureDriver()

    expect(getCaptureSettings().driver).toBe('obs')
  })

  it('stays OBS on an install that set capture up and switched it off', () => {
    setBoolSetting(db, 'capture.enabled', false)

    pinCaptureDriver()

    expect(getCaptureSettings().driver).toBe('obs')
  })

  it('never overrides a choice already made', () => {
    setBoolSetting(db, 'capture.enabled', true)
    setSetting(db, 'capture.driver', 'native')

    pinCaptureDriver()

    expect(getCaptureSettings().driver).toBe('native')
  })

  it('is whatever the settings screen last chose', () => {
    expect(setCaptureSettings({ driver: 'obs' }).driver).toBe('obs')
    expect(setCaptureSettings({ driver: 'native' }).driver).toBe('native')
  })
})

describe('the microphone the native recorder mixes in', () => {
  it('is the system default until one is chosen, and again once cleared', () => {
    expect(getCaptureSettings().micDeviceId).toBeNull()
    expect(setCaptureSettings({ micDeviceId: 'mic-1' }).micDeviceId).toBe('mic-1')
    expect(setCaptureSettings({ micDeviceId: null }).micDeviceId).toBeNull()
  })
})
