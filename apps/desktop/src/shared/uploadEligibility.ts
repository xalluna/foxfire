import { YOUTUBE_ENABLED } from './features'
import type { Recording, RecordingUpload, UploadState } from './types'

/**
 * Which recordings can be offered for YouTube, decided once for both sides.
 *
 * Main answers "every eligible recording" for the Recordings tab's "select
 * all", and the tab decides which of the rows it has drawn get a checkbox. If
 * the two disagreed, select-all would pick recordings the list never offered,
 * or leave out ones it did — so the rule lives here and both import it.
 */

/** Upload states that mean "on its way": it will carry on by itself. */
export const PENDING_UPLOAD_STATES: readonly UploadState[] = [
  'queued',
  'uploading',
  'paused',
  'waiting_quota',
  'waiting_auth'
]

/** Whether an upload of this recording is on its way, in any state that will carry on by itself. */
export function isUploadPending(upload: Pick<RecordingUpload, 'state'> | null): boolean {
  return upload !== null && PENDING_UPLOAD_STATES.includes(upload.state)
}

/**
 * Whether a recording can be put on YouTube from here: this build has YouTube
 * in it, the file is still on disk, nothing of it is on YouTube yet, and no
 * upload of it is already on its way.
 */
export function canUploadRecording(recording: Pick<Recording, 'fileExists' | 'youtube' | 'upload'>): boolean {
  return YOUTUBE_ENABLED && recording.fileExists && recording.youtube === null && !isUploadPending(recording.upload)
}
