import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canUploadRecording } from '@shared/uploadEligibility'
import { applyAllMigrations } from '../testMigrations'
import type { AccountContext } from '../accountScope'
import {
  bindRecording,
  createRecording,
  finishRecording,
  getOldestRecordingIds,
  getRecordingArtefactsForMatches,
  getRecordingIdentity,
  getRecordingUsage,
  getRecordings,
  getUploadableRecordingIds,
  getUploadableRecordings,
  markFileDeleted,
  setServerCopy
} from './recordings.repo'
import {
  enqueueUpload,
  getUpload,
  pendingUploads,
  requeueInterrupted,
  updateUpload,
  uploadTotals,
  type NewUpload
} from './mediaUploads.repo'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const SERVER = 'https://foxfire.example.com'
const ACCOUNT: AccountContext = { accountId: '1', riotId: 'Faker#NA1', serverKey: SERVER }
const T0 = 1_700_000_000_000
const VIDEO = 'abcdefghijk'

/** More than any test here makes, so a read is every recording. */
const EVERY = { limit: 100, offset: 0 }

let db: DatabaseSyncType

function recording(name: string, startedAt = T0): number {
  const path = `C:\\Videos\\Foxfire\\${name}.mp4`
  const id = createRecording(db, {
    accountId: ACCOUNT.accountId,
    riotId: ACCOUNT.riotId,
    serverKey: null,
    filePath: path,
    queueId: 420,
    startedAt,
    gameTimeOffset: 40,
    selfChampionId: 103,
    roster: []
  })
  finishRecording(db, id, startedAt + 1_800_000, path, 1_000_000)
  return id
}

function onServer(id: number, serverKey = SERVER): void {
  setServerCopy(db, id, { videoId: VIDEO, serverKey, at: T0 })
}

const job = (recordingId: number, over: Partial<NewUpload> = {}): NewUpload => ({
  recordingId,
  serverKey: SERVER,
  trigger: 'manual',
  deleteAfter: false,
  fileBytes: 1_000_000,
  fileMtime: T0,
  ...over
})

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyAllMigrations(db)
})

describe('the upload queue', () => {
  it('queues oldest first, and only what is still on its way', () => {
    const first = recording('first')
    const second = recording('second')
    const third = recording('third')
    enqueueUpload(db, job(second), T0 + 10)
    enqueueUpload(db, job(first), T0 + 5)
    enqueueUpload(db, job(third), T0 + 15)
    updateUpload(db, second, { state: 'done' }, T0 + 20)
    updateUpload(db, third, { state: 'processing' }, T0 + 20)

    // Processing is still on its way: the queue asks after it until it is ready.
    expect(pendingUploads(db).map((upload) => upload.recordingId)).toEqual([first, third])
  })

  it('starts afresh when asked again, forgetting the old upload and its offset', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    updateUpload(
      db,
      id,
      { state: 'failed', videoId: VIDEO, uploadUrl: 'https://media/uploads/tus/abc', confirmedOffset: 512, lastError: 'no' },
      T0 + 1
    )

    enqueueUpload(db, job(id, { trigger: 'bulk', deleteAfter: true }), T0 + 2)

    expect(getUpload(db, id)).toMatchObject({
      state: 'queued',
      trigger: 'bulk',
      deleteAfter: true,
      videoId: null,
      uploadUrl: null,
      confirmedOffset: 0,
      lastError: null
    })
  })

  it('puts an upload the app quit in the middle of back in the queue, keeping where it got to', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    updateUpload(db, id, { state: 'uploading', uploadUrl: 'https://media/uploads/tus/abc', confirmedOffset: 52_428_800 }, T0 + 1)

    requeueInterrupted(db, T0 + 2)

    expect(getUpload(db, id)).toMatchObject({
      state: 'queued',
      uploadUrl: 'https://media/uploads/tus/abc',
      confirmedOffset: 52_428_800
    })
  })

  it('stores whole numbers, so an offset reads back as the number it was', () => {
    const id = recording('game')
    enqueueUpload(db, job(id, { fileMtime: T0 + 0.75 }), T0)
    updateUpload(db, id, { confirmedOffset: 52_428_800 }, T0 + 1)

    const stored = db.prepare('SELECT typeof(confirmed_offset) AS o, typeof(file_mtime) AS m FROM media_uploads').get() as {
      o: string
      m: string
    }
    expect(stored).toEqual({ o: 'integer', m: 'integer' })
    expect(getUpload(db, id)?.fileMtime).toBe(T0)
  })

  it('goes with the recording it was uploading', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id)
    expect(getUpload(db, id)).toBeNull()
  })

  it('shows on the recording, for the Recordings tab', () => {
    const id = recording('game')
    enqueueUpload(db, job(id, { deleteAfter: true }), T0)
    updateUpload(db, id, { state: 'uploading', confirmedOffset: 250_000 }, T0 + 1)

    expect(getRecordings(db, ACCOUNT, EVERY)[0]?.upload).toMatchObject({
      state: 'uploading',
      bytesSent: 250_000,
      fileBytes: 1_000_000,
      deleteAfter: true
    })
  })

  it('adds up what is still to go, for the queue’s summary', () => {
    const a = recording('a')
    const b = recording('b')
    const c = recording('c')
    enqueueUpload(db, job(a), T0)
    enqueueUpload(db, job(b, { fileBytes: 3_000_000 }), T0)
    enqueueUpload(db, job(c), T0)
    updateUpload(db, b, { state: 'uploading', confirmedOffset: 1_000_000 }, T0)
    updateUpload(db, c, { state: 'processing' }, T0)

    expect(uploadTotals(db)).toEqual({ waiting: 2, processing: 1, failed: 0, remainingBytes: 3_000_000 })
  })
})

describe('a recording on the server', () => {
  it('tells a match row whether the server has it, and whether an upload is on its way', () => {
    const uploaded = recording('uploaded')
    const pending = recording('pending', T0 + 3_600_000)
    bindRecording(db, uploaded, 'NA1_1')
    bindRecording(db, pending, 'NA1_2')
    onServer(uploaded)
    markFileDeleted(db, uploaded, T0 + 1)
    enqueueUpload(db, job(pending, { trigger: 'auto' }), T0)

    const artefacts = getRecordingArtefactsForMatches(db, ACCOUNT, ['NA1_1', 'NA1_2', 'NA1_3'])

    expect(artefacts.get('NA1_1')).toEqual({ recordingId: uploaded, onServer: true, fileDeleted: true, uploadPending: false })
    expect(artefacts.get('NA1_2')).toEqual({ recordingId: pending, onServer: false, fileDeleted: false, uploadPending: true })
    expect(artefacts.has('NA1_3')).toBe(false)
  })

  it('remembers which server has it', () => {
    const id = recording('game')
    onServer(id)
    expect(getRecordings(db, ACCOUNT, EVERY)[0]?.server).toEqual({ videoId: VIDEO, serverKey: SERVER, at: T0 })
    expect(getRecordingIdentity(db, id)).toMatchObject({ serverVideoId: VIDEO, serverVideoKey: SERVER })

    setServerCopy(db, id, null)
    expect(getRecordings(db, ACCOUNT, EVERY)[0]?.server).toBeNull()
  })

  it('stops counting against the disk once its file is deleted', () => {
    const kept = recording('kept')
    const freed = recording('freed', T0 - 1)
    onServer(freed)
    markFileDeleted(db, freed, T0 + 1)

    expect(getRecordingUsage(db)).toMatchObject({ totalBytes: 1_000_000, count: 1 })
    // "Delete the 5 oldest" frees nothing by picking a recording that is already only on the server.
    expect(getOldestRecordingIds(db, ACCOUNT, 5)).toEqual([kept])
  })
})

describe('every recording that can go up', () => {
  let folder: string

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'foxfire-eligible-'))
  })

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true })
  })

  /** A finished recording whose file is really there and that found its game. */
  function onDisk(name: string, startedAt: number, matchId: string | null = `NA1_${name}`): number {
    const path = join(folder, `${name}.mp4`)
    writeFileSync(path, 'not really a video')
    const id = createRecording(db, {
      accountId: ACCOUNT.accountId,
      riotId: ACCOUNT.riotId,
      serverKey: null,
      filePath: path,
      queueId: 420,
      startedAt,
      gameTimeOffset: 40,
      selfChampionId: 103,
      roster: []
    })
    finishRecording(db, id, startedAt + 1_800_000, path, 1_000_000)
    if (matchId) bindRecording(db, id, matchId)
    return id
  }

  it('is every one with a file and a game, not on this server, nothing on its way, newest first', () => {
    const older = onDisk('older', T0)
    const newer = onDisk('newer', T0 + 60_000)
    const queued = onDisk('queued', T0 + 120_000)
    const uploaded = onDisk('uploaded', T0 + 180_000)
    const failed = onDisk('failed', T0 + 240_000)
    const elsewhere = onDisk('elsewhere', T0 + 270_000)
    onDisk('unbound', T0 + 280_000, null)
    recording('missing', T0 + 300_000)

    enqueueUpload(db, job(queued), T0)
    onServer(uploaded)
    // On another server: this one does not have it.
    onServer(elsewhere, 'https://other.example.com')
    // A failed upload is not on its way, so the recording can be offered again.
    enqueueUpload(db, job(failed), T0)
    updateUpload(db, failed, { state: 'failed' }, T0 + 1)

    expect(getUploadableRecordings(db, ACCOUNT, SERVER).map((r) => r.id)).toEqual([elsewhere, failed, newer, older])
    expect(getUploadableRecordingIds(db, SERVER)).toEqual([older, newer, failed, elsewhere])
  })

  it('is nothing off a server', () => {
    onDisk('a', T0)
    expect(getUploadableRecordings(db, ACCOUNT, null)).toEqual([])
  })

  it('agrees with the rule the Recordings tab draws its checkboxes by', () => {
    onDisk('a', T0)
    const queued = onDisk('b', T0 + 60_000)
    onServer(onDisk('c', T0 + 120_000))
    onDisk('d', T0 + 150_000, null)
    recording('gone', T0 + 180_000)
    enqueueUpload(db, job(queued), T0)

    const byTheTab = getRecordings(db, ACCOUNT, EVERY)
      .filter((recording) => canUploadRecording(recording, SERVER))
      .map((r) => r.id)

    expect(getUploadableRecordings(db, ACCOUNT, SERVER).map((r) => r.id)).toEqual(byTheTab)
  })
})
