import type { DatabaseSync } from 'node:sqlite'
import type { UploadState, YouTubePrivacy } from '@shared/types'
import { PENDING_UPLOAD_STATES } from './recordings.repo'

/**
 * The queue of recordings going to YouTube.
 *
 * One row per recording, kept after it finishes so the Recordings tab can say
 * what happened. The session URI and confirmed offset are what make an upload
 * resumable: saved after every chunk, they are all the uploader needs to carry
 * on after a restart, a game, or a dropped connection.
 */
export interface UploadJob {
  recordingId: number
  state: UploadState
  trigger: 'manual' | 'auto'
  title: string
  description: string
  privacy: YouTubePrivacy
  fileBytes: number | null
  sessionUri: string | null
  confirmedOffset: number
  attempts: number
  nextAttemptAt: number | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

interface UploadRow {
  recording_id: number
  state: string
  trigger: string
  title: string
  description: string
  privacy: string
  file_bytes: number | null
  session_uri: string | null
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
    state: row.state as UploadState,
    trigger: row.trigger === 'auto' ? 'auto' : 'manual',
    title: row.title,
    description: row.description,
    privacy: row.privacy as YouTubePrivacy,
    fileBytes: row.file_bytes,
    sessionUri: row.session_uri,
    confirmedOffset: row.confirmed_offset,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Queues an upload, replacing whatever finished or failed before it.
 *
 * A recording has at most one upload, and asking again after a failure or a
 * cancel is asking for a fresh one — the old session is not worth resuming if
 * the title or privacy has changed, and YouTube would keep the old metadata.
 */
export function enqueueUpload(
  db: DatabaseSync,
  input: {
    recordingId: number
    trigger: 'manual' | 'auto'
    title: string
    description: string
    privacy: YouTubePrivacy
    fileBytes: number | null
  },
  now: number
): void {
  db.prepare(
    `INSERT INTO youtube_uploads
       (recording_id, state, trigger, title, description, privacy, file_bytes,
        session_uri, confirmed_offset, attempts, next_attempt_at, last_error, created_at, updated_at)
     VALUES (?, 'queued', ?, ?, ?, ?, ?, NULL, 0, 0, NULL, NULL, ?, ?)
     ON CONFLICT(recording_id) DO UPDATE SET
       state = 'queued', trigger = excluded.trigger, title = excluded.title,
       description = excluded.description, privacy = excluded.privacy,
       file_bytes = excluded.file_bytes, session_uri = NULL, confirmed_offset = 0,
       attempts = 0, next_attempt_at = NULL, last_error = NULL,
       created_at = excluded.created_at, updated_at = excluded.updated_at`
  ).run(
    input.recordingId,
    input.trigger,
    input.title,
    input.description,
    input.privacy,
    input.fileBytes,
    now,
    now
  )
}

export function getUpload(db: DatabaseSync, recordingId: number): UploadJob | null {
  const row = db.prepare('SELECT * FROM youtube_uploads WHERE recording_id = ?').get(recordingId) as unknown as
    | UploadRow
    | undefined
  return row ? toJob(row) : null
}

/**
 * The oldest upload still to finish, in any state that means "on its way".
 *
 * Oldest first, so an auto-upload queued yesterday is not overtaken forever by
 * games played since. Whether it may run now — a game, the quota, a backoff —
 * is the queue's call, not this query's.
 */
export function pendingUploads(db: DatabaseSync): UploadJob[] {
  const rows = db
    .prepare(
      `SELECT * FROM youtube_uploads
        WHERE state IN (${PENDING_UPLOAD_STATES})
        ORDER BY created_at ASC`
    )
    .all() as unknown as UploadRow[]
  return rows.map(toJob)
}

export function hasUpload(db: DatabaseSync, recordingId: number): boolean {
  return db.prepare('SELECT 1 AS x FROM youtube_uploads WHERE recording_id = ?').get(recordingId) !== undefined
}

export function updateUpload(
  db: DatabaseSync,
  recordingId: number,
  patch: Partial<
    Pick<UploadJob, 'state' | 'sessionUri' | 'confirmedOffset' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'fileBytes'>
  >,
  now: number
): void {
  const columns: Record<keyof typeof patch, string> = {
    state: 'state',
    sessionUri: 'session_uri',
    confirmedOffset: 'confirmed_offset',
    attempts: 'attempts',
    nextAttemptAt: 'next_attempt_at',
    lastError: 'last_error',
    fileBytes: 'file_bytes'
  }

  const keys = (Object.keys(patch) as Array<keyof typeof patch>).filter((key) => patch[key] !== undefined)
  if (keys.length === 0) return

  const assignments = keys.map((key) => `${columns[key]} = ?`).join(', ')
  const values = keys.map((key) => patch[key] as string | number | null)

  db.prepare(`UPDATE youtube_uploads SET ${assignments}, updated_at = ? WHERE recording_id = ?`).run(
    ...values,
    now,
    recordingId
  )
}

/**
 * Picks up where a previous run left off.
 *
 * An upload that was mid-chunk when the app quit is still marked uploading;
 * nothing is uploading at launch, so it goes back to the queue and resumes
 * from the offset it last confirmed.
 */
export function requeueInterrupted(db: DatabaseSync, now: number): void {
  db.prepare(
    `UPDATE youtube_uploads SET state = 'queued', updated_at = ?
      WHERE state IN ('uploading', 'paused')`
  ).run(now)
}
