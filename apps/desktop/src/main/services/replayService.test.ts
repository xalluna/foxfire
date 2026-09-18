import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyAllMigrations } from '../db/testMigrations'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

// A real in-memory database behind getDb, so the ingest and the tombstone run
// against the SQL that ships rather than a stubbed repository.
const live = vi.hoisted(() => ({
  db: null as unknown,
  sourceFolder: '' as string,
  destFolder: '' as string
}))

vi.mock('../db', () => ({ getDb: () => live.db }))

// The account context reaches the API layer, which reaches Electron. These
// tests are about what the service does with the answer, not where it came
// from — the Riot ID is here so the "claimed by either handle" predicate is
// exercised rather than bypassed.
vi.mock('../api/accountContext', () => ({
  accountContext: (accountId: string) =>
    Promise.resolve({ accountId, riotId: 'Alluna#NA1', serverKey: null })
}))
vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} })
}))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { showItemInFolder: () => {} }
}))
vi.mock('./roflSettings', () => ({
  getRoflSettings: () => ({
    enabled: true,
    sourceFolder: live.sourceFolder,
    resolvedSourceFolder: live.sourceFolder,
    autoRecordEnabled: true,
    folder: live.destFolder,
    softCapBytes: 0
  }),
  defaultSourceFolder: () => live.sourceFolder
}))
// The live-client lookup shells out to PowerShell; none of that is the point here.
vi.mock('./clientArchiveService', () => ({
  resolveSourceFolder: (override: string | null) => Promise.resolve(override ?? live.sourceFolder),
  resolveLiveClient: () => Promise.resolve({ path: 'C:\\live', patch: '16.16' })
}))

const { removeReplay, scanReplayFolder, listReplays } = await import('./replayService')

/**
 * A .rofl the parser will accept: the magic, the offset table, and a metadata
 * blob. Built rather than committed so the bytes under test are visible — see
 * rofl/header.test.ts, which owns the parsing itself.
 */
function writeRofl(path: string, gameVersion = '16.16.804.9184'): void {
  const blob = Buffer.from(
    JSON.stringify({ gameLength: 1_834_000, gameVersion, statsJson: '[]' }),
    'utf8'
  )
  const head = Buffer.alloc(288)
  head.write('RIOT', 0, 'latin1')
  head.writeUInt16LE(288, 262)
  head.writeUInt32LE(288 + blob.length, 264)
  head.writeUInt32LE(288, 268)
  head.writeUInt32LE(blob.length, 272)
  writeFileSync(path, Buffer.concat([head, blob]))
}

let root: string

beforeEach(() => {
  const db = new DatabaseSync(':memory:')
  applyAllMigrations(db)
  live.db = db

  root = mkdtempSync(join(tmpdir(), 'foxfire-rofl-'))
  live.sourceFolder = join(root, 'riot')
  live.destFolder = join(root, 'foxfire')
  mkdirSync(live.sourceFolder, { recursive: true })
})

afterEach(() => {
  const db = live.db as DatabaseSyncType
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('replay ingest', () => {
  it('copies a replay and links it by filename alone', async () => {
    writeRofl(join(live.sourceFolder, 'NA1-5312345678.rofl'))

    expect(await scanReplayFolder()).toBe(1)

    const replays = await listReplays('1')
    expect(replays).toHaveLength(1)
    expect(replays[0]?.matchId).toBe('NA1_5312345678')
    // The patch is what decides which client can play it back.
    expect(replays[0]?.patch).toBe('16.16')
    // Riot's original is ours to read, never to move.
    expect(existsSync(join(live.sourceFolder, 'NA1-5312345678.rofl'))).toBe(true)
    expect(readdirSync(live.destFolder)).toEqual(['NA1-5312345678.rofl'])
  })

  it('does not import the same file twice', async () => {
    writeRofl(join(live.sourceFolder, 'NA1-5312345678.rofl'))

    expect(await scanReplayFolder()).toBe(1)
    expect(await scanReplayFolder()).toBe(0)
    expect(await listReplays('1')).toHaveLength(1)
  })

  it('ingests a replay whose header cannot be read, keeping the name link', async () => {
    // A format change must cost the patch, never the replay.
    writeFileSync(join(live.sourceFolder, 'NA1-5312345679.rofl'), Buffer.from('RIOT garbage'))

    expect(await scanReplayFolder()).toBe(1)

    const replays = await listReplays('1')
    expect(replays[0]?.matchId).toBe('NA1_5312345679')
    expect(replays[0]?.patch).toBeNull()
    expect(replays[0]?.blockedReason).toMatch(/could not read/i)
  })

  it('skips a file that is neither readable nor Riot-named', async () => {
    // Stands in for a part-downloaded file: no header yet, no usable name.
    writeFileSync(join(live.sourceFolder, 'half-written.rofl'), Buffer.from('RIOT'))

    expect(await scanReplayFolder()).toBe(0)
    expect(await listReplays('1')).toHaveLength(0)
  })

  it('ignores files that are not replays', async () => {
    writeFileSync(join(live.sourceFolder, 'notes.txt'), 'nothing to see')

    expect(await scanReplayFolder()).toBe(0)
  })
})

describe('replay deletion', () => {
  it('deletes our copy and never Riot\u2019s', async () => {
    const source = join(live.sourceFolder, 'NA1-5312345678.rofl')
    writeRofl(source)
    await scanReplayFolder()

    const [replay] = await listReplays('1')
    removeReplay(replay!.id)

    expect(await listReplays('1')).toHaveLength(0)
    expect(readdirSync(live.destFolder)).toEqual([])
    expect(existsSync(source)).toBe(true)
  })

  it('stays deleted when the folder is scanned again', async () => {
    // The reason the row is a tombstone rather than a DELETE. Riot's original is
    // still sitting there, so without it the next scan would import the file
    // straight back and the delete button would undo itself.
    writeRofl(join(live.sourceFolder, 'NA1-5312345678.rofl'))
    await scanReplayFolder()

    const [replay] = await listReplays('1')
    removeReplay(replay!.id)

    expect(await scanReplayFolder()).toBe(0)
    expect(await listReplays('1')).toHaveLength(0)
  })
})

describe('playability', () => {
  it('is watchable on the live patch without any archive', async () => {
    writeRofl(join(live.sourceFolder, 'NA1-5312345678.rofl'), '16.16.804.9184')
    await scanReplayFolder()

    expect((await listReplays('1'))[0]?.blockedReason).toBeNull()
  })

  it('names the patch it needs when nothing can play it', async () => {
    writeRofl(join(live.sourceFolder, 'NA1-5312345600.rofl'), '15.14.600.4410')
    await scanReplayFolder()

    expect((await listReplays('1'))[0]?.blockedReason).toBe('Needs a League client for patch 15.14')
  })

  it('becomes watchable once a matching archive is registered', async () => {
    writeRofl(join(live.sourceFolder, 'NA1-5312345600.rofl'), '15.14.600.4410')
    await scanReplayFolder()
    ;(live.db as DatabaseSyncType)
      .prepare("INSERT INTO client_archives (path, patch, patch_source) VALUES (?, '15.14', 'detected')")
      .run('D:\\archives\\15.14')

    expect((await listReplays('1'))[0]?.blockedReason).toBeNull()
  })
})
