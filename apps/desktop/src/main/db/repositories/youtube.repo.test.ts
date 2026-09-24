import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyAllMigrations } from '../testMigrations'
import type { AccountContext } from '../accountScope'
import {
  bindRecording,
  createRecording,
  finishRecording,
  getOldestRecordingIds,
  getRecordingArtefactsForMatches,
  getRecordingUsage,
  getRecordings,
  markFileDeleted,
  setYouTubeCopy
} from './recordings.repo'
import { enqueueUpload, getUpload, pendingUploads, requeueInterrupted, updateUpload } from './youtubeUploads.repo'
import { attachCandidates, recordAttachment } from './recordingAttachments.repo'

// See matches.repo.test.ts: Vite strips the `node:` prefix during transform and
// then cannot resolve the bare `sqlite` specifier.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSyncType
}

const ACCOUNT: AccountContext = { accountId: '1', riotId: 'Faker#NA1', serverKey: 'https://foxfire.example.com' }
const T0 = 1_700_000_000_000
const VIDEO = 'dQw4w9WgXcQ'

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

function onYouTube(id: number, videoId = VIDEO): void {
  setYouTubeCopy(db, id, { videoId, privacy: 'unlisted', forcedPrivate: false, source: 'upload', title: 'Ahri', at: T0 })
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyAllMigrations(db)
})

describe('the upload queue', () => {
  const job = (recordingId: number) => ({
    recordingId,
    trigger: 'manual' as const,
    title: 'Ahri',
    description: '0:00 Start',
    privacy: 'unlisted' as const,
    fileBytes: 1_000_000
  })

  it('queues oldest first, and only what is still on its way', () => {
    const first = recording('first')
    const second = recording('second')
    enqueueUpload(db, job(second), T0 + 10)
    enqueueUpload(db, job(first), T0 + 5)
    updateUpload(db, second, { state: 'done' }, T0 + 20)

    expect(pendingUploads(db).map((upload) => upload.recordingId)).toEqual([first])
  })

  it('starts a fresh upload when asked again, rather than resuming an old session', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    updateUpload(db, id, { state: 'failed', sessionUri: 'https://upload/abc', confirmedOffset: 512, lastError: 'no' }, T0 + 1)

    enqueueUpload(db, { ...job(id), title: 'A better title' }, T0 + 2)

    expect(getUpload(db, id)).toMatchObject({
      state: 'queued',
      title: 'A better title',
      sessionUri: null,
      confirmedOffset: 0,
      lastError: null
    })
  })

  it('puts an upload the app quit in the middle of back in the queue, keeping its session', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    updateUpload(db, id, { state: 'uploading', sessionUri: 'https://upload/abc', confirmedOffset: 8_388_608 }, T0 + 1)

    requeueInterrupted(db, T0 + 2)

    expect(getUpload(db, id)).toMatchObject({ state: 'queued', sessionUri: 'https://upload/abc', confirmedOffset: 8_388_608 })
  })

  it('goes with the recording it was uploading', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    db.prepare('DELETE FROM recordings WHERE id = ?').run(id)
    expect(getUpload(db, id)).toBeNull()
  })

  it('shows on the recording, for the Recordings tab', () => {
    const id = recording('game')
    enqueueUpload(db, job(id), T0)
    updateUpload(db, id, { state: 'uploading', confirmedOffset: 250_000 }, T0 + 1)

    expect(getRecordings(db, ACCOUNT)[0]?.upload).toMatchObject({
      state: 'uploading',
      bytesSent: 250_000,
      fileBytes: 1_000_000
    })
  })
})

describe('a recording on YouTube', () => {
  it('tells a match row its video and whether an upload is on its way', () => {
    const uploaded = recording('uploaded')
    const pending = recording('pending', T0 + 3_600_000)
    bindRecording(db, uploaded, 'NA1_1')
    bindRecording(db, pending, 'NA1_2')
    onYouTube(uploaded)
    enqueueUpload(
      db,
      { recordingId: pending, trigger: 'auto', title: 'x', description: 'y', privacy: 'unlisted', fileBytes: 1 },
      T0
    )

    const artefacts = getRecordingArtefactsForMatches(db, ACCOUNT, ['NA1_1', 'NA1_2', 'NA1_3'])

    expect(artefacts.get('NA1_1')).toEqual({ recordingId: uploaded, videoId: VIDEO, uploadPending: false })
    expect(artefacts.get('NA1_2')).toEqual({ recordingId: pending, videoId: null, uploadPending: true })
    expect(artefacts.has('NA1_3')).toBe(false)
  })

  it('stops counting against the disk once its file is deleted', () => {
    const kept = recording('kept')
    const freed = recording('freed', T0 - 1)
    onYouTube(freed)
    markFileDeleted(db, freed, T0 + 1)

    expect(getRecordingUsage(db)).toMatchObject({ totalBytes: 1_000_000, count: 1 })
    // "Delete the 5 oldest" frees nothing by picking a recording that is already only on YouTube.
    expect(getOldestRecordingIds(db, ACCOUNT, 5)).toEqual([kept])
  })

  it('reports whether the active server has its video', () => {
    const id = recording('game')
    bindRecording(db, id, 'NA1_1')
    onYouTube(id)
    recordAttachment(
      db,
      {
        recordingId: id,
        serverKey: ACCOUNT.serverKey!,
        riotAccountId: 'guid',
        matchId: 'NA1_1',
        videoId: VIDEO,
        state: 'conflict',
        message: 'Already has one'
      },
      T0
    )

    expect(getRecordings(db, ACCOUNT)[0]?.attachment).toEqual({ state: 'conflict', message: 'Already has one' })
    expect(getRecordings(db, { ...ACCOUNT, serverKey: 'https://other.example.com' })[0]?.attachment).toBeNull()
  })
})

describe('attachCandidates', () => {
  it('offers every recording with a video and a game, with what this server was last told', () => {
    const told = recording('told')
    const untold = recording('untold', T0 + 1)
    const noGame = recording('no-game', T0 + 2)
    const noVideo = recording('no-video', T0 + 3)
    bindRecording(db, told, 'NA1_1')
    bindRecording(db, untold, 'NA1_2')
    bindRecording(db, noVideo, 'NA1_4')
    onYouTube(told)
    onYouTube(untold, 'abcdefghijk')
    onYouTube(noGame)
    recordAttachment(
      db,
      {
        recordingId: told,
        serverKey: ACCOUNT.serverKey!,
        riotAccountId: 'guid',
        matchId: 'NA1_1',
        videoId: VIDEO,
        state: 'attached',
        message: null
      },
      T0
    )

    const candidates = attachCandidates(db, ACCOUNT.serverKey!)

    expect(candidates.map((candidate) => [candidate.recordingId, candidate.attachedVideoId])).toEqual([
      [told, VIDEO],
      [untold, null]
    ])
  })
})
