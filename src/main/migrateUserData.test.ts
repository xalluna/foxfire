import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
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
  writeFileSync(join(legacy, 'Local State'), '{"os_crypt":{"encrypted_key":"OLD"}}')
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

  /**
   * The bug this suite exists for.
   *
   * A build that ran under the new name before the data came across leaves
   * every destination directory already present. Skipping those and reporting a
   * successful migration anyway is what happened in practice: the database sat
   * untouched in the old location while the app built an empty one beside it
   * and the log claimed the move had worked.
   */
  it('migrates even when every destination directory already exists', () => {
    seedLegacy()
    for (const name of ['data', 'secure', 'logs']) {
      mkdirSync(join(current, name), { recursive: true })
    }
    writeFileSync(join(current, 'data', 'stats.db.bak-old'), 'STALE')

    migrateUserData()

    expect(readFileSync(join(current, 'data', 'stats.db'), 'utf8')).toBe('STATS')
    expect(readFileSync(join(current, 'secure', 'riot-api-key.enc'), 'utf8')).toBe('KEY')
  })

  /**
   * A stale write-ahead log replayed against a database it never belonged to is
   * worse than any amount of leftover disk, so the pre-existing directory is
   * set aside whole rather than merged into.
   */
  it('sets a pre-existing destination directory aside instead of merging into it', () => {
    seedLegacy()
    mkdirSync(join(current, 'data'), { recursive: true })
    writeFileSync(join(current, 'data', 'stats.db-wal'), 'STALE-WAL')

    migrateUserData()

    // The incoming database is not sharing a directory with the old WAL.
    expect(existsSync(join(current, 'data', 'stats.db-wal'))).toBe(false)
    expect(readFileSync(join(current, 'data', 'stats.db'), 'utf8')).toBe('STATS')

    // And the old one is kept, not deleted.
    const setAside = readdirSync(current).find((n) => n.startsWith('data.superseded-'))
    expect(setAside).toBeDefined()
    expect(readFileSync(join(current, setAside!, 'stats.db-wal'), 'utf8')).toBe('STALE-WAL')
  })

  /**
   * The second half of the same bug. safeStorage on Windows encrypts with a key
   * kept in Local State, so moving secure/ without it strands both secrets —
   * and loadApiKey turns a failed decrypt into a null, which reads as "no key
   * has ever been entered" rather than as an error.
   */
  it('carries Local State, without which the moved secrets cannot be decrypted', () => {
    seedLegacy()

    migrateUserData()

    expect(readFileSync(join(current, 'Local State'), 'utf8')).toContain('OLD')
  })

  it('does not let a freshly generated Local State win over the one that owns the secrets', () => {
    seedLegacy()
    mkdirSync(current, { recursive: true })
    writeFileSync(join(current, 'Local State'), '{"os_crypt":{"encrypted_key":"FRESH"}}')

    migrateUserData()

    expect(readFileSync(join(current, 'Local State'), 'utf8')).toContain('OLD')
  })

  it('leaves the legacy directory in place when it still holds Chromium state', () => {
    seedLegacy()
    mkdirSync(join(legacy, 'GPUCache'), { recursive: true })
    writeFileSync(join(legacy, 'GPUCache', 'data_0'), 'CACHE')

    migrateUserData()

    expect(existsSync(join(legacy, 'GPUCache'))).toBe(true)
    expect(existsSync(join(legacy, 'data'))).toBe(false)
  })
})
