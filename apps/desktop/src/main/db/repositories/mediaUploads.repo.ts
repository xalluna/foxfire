import type { DatabaseSync } from 'node:sqlite'
import type { UploadState, UploadTrigger } from '@shared/types'
import { PENDING_UPLOAD_STATES } from './recordings.repo'

/**
 * The queue of recordings going to the server's Foxfire Media.
 *
 * One row per recording, kept after it finishes so the Recordings tab can say
 * what happened. What makes an upload resumable is here — its address on
 * Foxfire Media's tus endpoint, and how much it has confirmed — except the
 * token that opens it, which is a credential and lives in the secret store.
 */
export interface UploadJob {
  recordingId: number
  /** The server it is going to, as `server_key` spells it. */
  serverKey: string
  state: UploadState
  trigger: UploadTrigger
  deleteAfter: boolean
  fileBytes: number | null
  /** The file's modification time when it was queued, epoch milliseconds. */
  fileMtime: number | null
  videoId: string | null
  uploadUrl: string | null
  confirmedOffset: number
  attempts: number
  nextAttemptAt: number | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

interface UploadRow {
  recording_id: number
  server_key: string
  state: string
  trigger: string
  delete_after: number
  file_bytes: number | null
  file_mtime: number | null
  video_id: string | null
  upload_url: string | null
  confirmed_offset: number
  attempts: number
  next_attempt_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

function toJob(row: UploadRow): UploadJob {
  return {
    recordingId: row.recording_id,
    serverKey: row.server_key,
    state: row.state as UploadState,
    trigger: row.trigger === 'auto' || row.trigger === 'bulk' ? row.trigger : 'manual',
    deleteAfter: row.delete_after === 1,
    fileBytes: row.file_bytes,
    fileMtime: row.file_mtime,
    videoId: row.video_id,
    uploadUrl: row.upload_url,
    confirmedOffset: row.confirmed_offset,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface NewUpload {
  recordingId: number
  serverKey: string
  trigger: UploadTrigger
  deleteAfter: boolean
  fileBytes: number
  fileMtime: number
}

/**
 * Queues an upload, replacing whatever finished, failed or was cancelled before it.
 *
 * A recording has at most one upload. Asking again after a failure starts it
 * over: the server is asked for a fresh token, and Foxfire Media either picks
 * the same video back up or makes a new one.
 */
export function enqueueUpload(db: DatabaseSync, input: NewUpload, now: number): void {
  db.prepare(
    `INSERT INTO media_uploads
       (recording_id, server_key, state, trigger, delete_after, file_bytes, file_mtime,
        video_id, upload_url, confirmed_offset, attempts, next_attempt_at, last_error, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, NULL, ?, ?)
     ON CONFLICT(recording_id) DO UPDATE SET
       server_key = excluded.server_key, state = 'queued', trigger = excluded.trigger,
       delete_after = excluded.delete_after, file_bytes = excluded.file_bytes,
       file_mtime = excluded.file_mtime, video_id = NULL, upload_url = NULL, confirmed_offset = 0,
       attempts = 0, next_attempt_at = NULL, last_error = NULL,
       created_at = excluded.created_at, updated_at = excluded.updated_at`
  ).run(
    input.recordingId,
    input.serverKey,
    input.trigger,
    input.deleteAfter ? 1 : 0,
    Math.trunc(input.fileBytes),
    Math.trunc(input.fileMtime),
    now,
    now
  )
}

export function getUpload(db: DatabaseSync, recordingId: number): UploadJob | null {
  const row = db.prepare('SELECT * FROM media_uploads WHERE recording_id = ?').get(recordingId) as unknown as
    | UploadRow
    | undefined
  return row ? toJob(row) : null
}

/**
 * Every upload still to finish, oldest first.
 *
 * Oldest first, so an automatic upload queued yesterday is not overtaken
 * forever by games played since, and a 500-recording batch goes up in the
 * order it was queued. Whether one may run now — a game, the server, a
 * backoff — is the queue's call, not this query's.
 */
export function pendingUploads(db: DatabaseSync): UploadJob[] {
  const rows = db
    .prepare(
      `SELECT * FROM media_uploads
        WHERE state IN (${PENDING_UPLOAD_STATES})
        ORDER BY created_at ASC, recording_id ASC`
    )
    .all() as unknown as UploadRow[]
  return rows.map(toJob)
}

export function hasUpload(db: DatabaseSync, recordingId: number): boolean {
  return db.prepare('SELECT 1 AS x FROM media_uploads WHERE recording_id = ?').get(recordingId) !== undefined
}

type Patch = Partial<
  Pick<
    UploadJob,
    'state' | 'videoId' | 'uploadUrl' | 'confirmedOffset' | 'attempts' | 'nextAttemptAt' | 'lastError'
  >
>

export function updateUpload(db: DatabaseSync, recordingId: number, patch: Patch, now: number): void {
  const columns: Record<keyof Patch, string> = {
    state: 'state',
    videoId: 'video_id',
    uploadUrl: 'upload_url',
    confirmedOffset: 'confirmed_offset',
    attempts: 'attempts',
    nextAttemptAt: 'next_attempt_at',
    lastError: 'last_error'
  }

  const keys = (Object.keys(patch) as Array<keyof Patch>).filter((key) => patch[key] !== undefined)
  if (keys.length === 0) return

  const assignments = keys.map((key) => `${columns[key]} = ?`).join(', ')
  // Whole numbers only into INTEGER columns: node:sqlite binds a JS number as
  // a REAL otherwise, and an offset of 52428800.0 compares badly later.
  const values = keys.map((key) => {
    const value = patch[key]
    return typeof value === 'number' ? Math.trunc(value) : (value as string | null)
  })

  db.prepare(`UPDATE media_uploads SET ${assignments}, updated_at = ? WHERE recording_id = ?`).run(
    ...values,
    now,
    recordingId
  )
}

/**
 * Picks up where a previous run left off.
 *
 * An upload that was mid-chunk when the app quit is still marked uploading;
 * nothing is uploading at launch, so it goes back to the queue and asks Foxfire
 * Media how far it got. One the queue had paused goes back too — whatever held
 * it is asked again.
 */
export function requeueInterrupted(db: DatabaseSync, now: number): void {
  db.prepare(
    `UPDATE media_uploads SET state = 'queued', updated_at = ?
      WHERE state IN ('uploading', 'paused')`
  ).run(now)
}

/** Every upload the server is still processing, for the queue to ask after. */
export function processingUploads(db: DatabaseSync): UploadJob[] {
  const rows = db
    .prepare(`SELECT * FROM media_uploads WHERE state = 'processing' ORDER BY updated_at ASC`)
    .all() as unknown as UploadRow[]
  return rows.map(toJob)
}

/** How much is waiting to go, for the queue's summary: counts by state and bytes still to send. */
export function uploadTotals(db: DatabaseSync): {
  waiting: number
  processing: number
  failed: number
  remainingBytes: number
} {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN state IN ('queued', 'uploading', 'paused') THEN 1 ELSE 0 END) AS waiting,
         SUM(CASE WHEN state = 'processing' THEN 1 ELSE 0 END) AS processing,
         SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN state IN ('queued', 'uploading', 'paused')
                  THEN MAX(COALESCE(file_bytes, 0) - confirmed_offset, 0) ELSE 0 END) AS remaining
         FROM media_uploads`
    )
    .get() as { waiting: number | null; processing: number | null; failed: number | null; remaining: number | null }

  return {
    waiting: row.waiting ?? 0,
    processing: row.processing ?? 0,
    failed: row.failed ?? 0,
    remainingBytes: row.remaining ?? 0
  }
}
