import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyAllMigrations } from '../db/testMigrations'

// The logger opens a file under app.getPath, so it needs Electron.
vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} })
}))

const { fileFinishedRecording, pruneEmptyFolders } = await import('./fileRecording')

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const STARTED = new Date(2026, 9, 23, 21, 4, 17).getTime()

describe('filing a finished recording', () => {
  let db: DatabaseSyncType
  let root: string

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    applyAllMigrations(db)
    root = mkdtempSync(join(tmpdir(), 'foxfire-recordings-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** A row as capture writes it, and the file OBS wrote for it. */
  function recorded(name: string, game: 'lol' | 'tft', queueId: number): { id: number; path: string } {
    const path = join(root, name)
    writeFileSync(path, 'video')
    // Ids as text, as capture writes them: see the note on node:sqlite numbers.
    db.prepare(
      `INSERT INTO recordings (account_id, riot_id, file_path, queue_id, started_at, game)
       VALUES ('1', 'Faker#KR1', ?, ?, ?, ?)`
    ).run(path, queueId, STARTED, game)
    const { id } = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }
    return { id, path }
  }

  it('moves it under the player, the game and the mode', () => {
    const { id, path } = recorded('obs-name.mp4', 'tft', 1100)

    const filed = fileFinishedRecording(db, id, path, root)

    expect(filed).toBe(join(root, 'Faker-KR1', 'TFT', 'Ranked', '2026-10-23 21-04-17.mp4'))
    expect(existsSync(filed)).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('numbers one that would land on another', () => {
    const first = recorded('one.mp4', 'lol', 420)
    const second = recorded('two.mp4', 'lol', 420)

    fileFinishedRecording(db, first.id, first.path, root)
    const filed = fileFinishedRecording(db, second.id, second.path, root)

    expect(filed).toBe(join(root, 'Faker-KR1', 'LoL', 'Solo-Duo', '2026-10-23 21-04-17 (2).mp4'))
  })

  it('leaves a file outside the folder where the person put it', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'foxfire-elsewhere-'))
    try {
      const path = join(elsewhere, 'mine.mp4')
      writeFileSync(path, 'video')
      db.prepare(
        "INSERT INTO recordings (account_id, file_path, queue_id, started_at) VALUES ('1', ?, 420, ?)"
      ).run(path, STARTED)

      expect(fileFinishedRecording(db, 1, path, root)).toBe(path)
      expect(existsSync(path)).toBe(true)
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('tidies the folders a deleted recording leaves empty, and nothing that still holds something', () => {
    const deep = join(root, 'Faker-KR1', 'TFT', 'Ranked')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(root, 'Faker-KR1', 'keep.txt'), 'x')

    pruneEmptyFolders(root, join(deep, 'gone.mp4'))

    expect(existsSync(join(root, 'Faker-KR1', 'TFT'))).toBe(false)
    expect(existsSync(join(root, 'Faker-KR1'))).toBe(true)
    expect(existsSync(root)).toBe(true)
  })
})
