import type { Recording, RecordingUpload, UploadState } from './types'

/**
 * Which recordings can be offered for the server, decided once for both sides.
 *
 * Main answers "every eligible recording" for the Recordings tab's "select
 * all", and the tab decides which of the rows it has drawn get a checkbox. If
 * the two disagreed, select-all would pick recordings the list never offered,
 * or leave out ones it did — so the rule lives here and both import it.
 */

/** Upload states that mean "on its way": it will carry on by itself. */
export const PENDING_UPLOAD_STATES: readonly UploadState[] = ['queued', 'uploading', 'paused', 'processing']

/** Whether an upload of this recording is on its way, in any state that will carry on by itself. */
export function isUploadPending(upload: Pick<RecordingUpload, 'state'> | null): boolean {
  return upload !== null && PENDING_UPLOAD_STATES.includes(upload.state)
}

/**
 * Whether a recording can be sent to the server from here: the file is still
 * on disk, it found its game — the server keeps a recording against a game,
 * so one that never found its own has nowhere to go — the server has not got
 * it yet, and no upload of it is already on its way.
 */
export function canUploadRecording(
  recording: Pick<Recording, 'fileExists' | 'matchId' | 'server' | 'upload'>,
  serverKey: string | null
): boolean {
  if (serverKey === null || !recording.fileExists || recording.matchId === null) return false
  if (recording.server?.serverKey === serverKey) return false
  return !isUploadPending(recording.upload)
}
