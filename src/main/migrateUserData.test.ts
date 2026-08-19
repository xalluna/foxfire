import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The rename from LoL Stats moves the one directory everything durable lives
 * in, so the guard deciding whether to move is the only thing standing between
 * a user and a silently empty database. These tests are about that decision
 * rather than about the copy: getting it wrong strands a year of match history
 * behind a fresh install that looks like a first run.
 */

const paths = vi.hoisted(() => ({ appData: '', userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? paths.appData : paths.userData),
    exit: () => {}
  },
  dialog: { showErrorBox: () => {} }
}))

vi.mock('./telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} })
}))

vi.mock('./security/keyStore', () => ({ hasStoredApiKey: () => true }))

const { migrateUserData } = await import('./migrateUserData')

let root: string
let legacy: string
let current: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'foxfire-migrate-'))
  legacy = join(root, 'my-op-gg')
  current = join(root, 'Foxfire')
  paths.appData = root
  paths.userData = current
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A LoL Stats install with everything the app keeps. */
function seedLegacy(): void {
  mkdirSync(join(legacy, 'data'), { recursive: true })
  writeFileSync(join(legacy, 'data', 'stats.db'), 'STATS')
  writeFileSync(join(legacy, 'data', 'telemetry.db'), 'TELEMETRY')
  mkdirSync(join(legacy, 'secure'), { recursive: true })
  writeFileSync(join(legacy, 'secure', 'riot-api-key.enc'), 'KEY')
  mkdirSync(join(legacy, 'logs'), { recursive: true })
  writeFileSync(join(legacy, 'logs', 'app.log'), 'LOG')
}

describe('migrateUserData', () => {
  it('carries the database, the secrets and the logs across', () => {
    seedLegacy()

    migrateUserData()

    expect(readFileSync(join(current, 'data', 'stats.db'), 'utf8')).toBe('STATS')
    expect(readFileSync(join(current, 'data', 'telemetry.db'), 'utf8')).toBe('TELEMETRY')
    expect(readFileSync(join(current, 'secure', 'riot-api-key.enc'), 'utf8')).toBe('KEY')
    expect(readFileSync(join(current, 'logs', 'app.log'), 'utf8')).toBe('LOG')
  })

  it('removes the legacy directory once it has been emptied', () => {
    seedLegacy()

    migrateUserData()

    expect(existsSync(legacy)).toBe(false)
  })

  it('leaves an install that has already migrated alone', () => {
    seedLegacy()
    mkdirSync(join(current, 'data'), { recursive: true })
    writeFileSync(join(current, 'data', 'stats.db'), 'NEWER')

    migrateUserData()

    expect(readFileSync(join(current, 'data', 'stats.db'), 'utf8')).toBe('NEWER')
    // The legacy copy is left where it is rather than deleted — it is the only
    // remaining record if the move it did not make turns out to have mattered.
    expect(readFileSync(join(legacy, 'data', 'stats.db'), 'utf8')).toBe('STATS')
  })

  it('does nothing on a first run with no legacy install', () => {
    migrateUserData()

    expect(existsSync(join(current, 'data'))).toBe(false)
  })

  /**
   * The regression the guard exists for. A crash after the log sink opened
   * leaves the new directory present but empty, and keying the decision on the
   * directory rather than on the database would read that as "already
   * migrated" and strand the real history for good.
   */
  it('still migrates when the new directory exists but holds no database', () => {
    seedLegacy()
    mkdirSync(join(current, 'logs'), { recursive: true })
    writeFileSync(join(current, 'logs', 'app.log'), 'CRASHED')

    migrateUserData()

    expect(readFileSync(join(current, 'data', 'stats.db'), 'utf8')).toBe('STATS')
  })

  it('does not overwrite a directory that already exists at the destination', () => {
    seedLegacy()
    mkdirSync(join(current, 'logs'), { recursive: true })
    writeFileSync(join(current, 'logs', 'app.log'), 'CRASHED')

    migrateUserData()

    // The data came across; the log the failed launch wrote is the one kept,
    // and the legacy logs directory stays behind rather than being merged.
    expect(readFileSync(join(current, 'logs', 'app.log'), 'utf8')).toBe('CRASHED')
    expect(existsSync(join(legacy, 'logs'))).toBe(true)
  })
})
