import type { Recording, RecordingUpload } from '@shared/types'
import { isUploadPending } from '@shared/uploadEligibility'

/** Percent of the file YouTube has, for an upload that knows its size. */
export function uploadPercent(upload: RecordingUpload): number | null {
  if (!upload.fileBytes) return null
  return Math.min(100, Math.floor((upload.bytesSent / upload.fileBytes) * 100))
}

/** Whether an upload of this recording is on its way, in any state that will carry on by itself. */
export function uploadPending(upload: RecordingUpload | null): boolean {
  return isUploadPending(upload)
}

/**
 * A few words on where a recording's upload is up to, or null for nothing to say.
 *
 * The same words in the Recordings tab and over the recording itself, so the
 * two never describe one upload differently.
 */
export function uploadStatusText(recording: Recording): string | null {
  const upload = recording.upload
  if (!upload) return null

  switch (upload.state) {
    case 'queued':
      return upload.resumesAt ? 'Upload waiting to try again' : 'Queued for YouTube'
    case 'uploading': {
      const percent = uploadPercent(upload)
      return percent === null ? 'Uploading…' : `Uploading ${percent}%`
    }
    case 'paused':
      return 'Upload paused — a game is on'
    case 'waiting_quota':
      return "Waiting for YouTube's daily quota"
    case 'waiting_auth':
      return 'Waiting for YouTube to be connected'
    case 'failed':
      return 'Upload failed'
    case 'cancelled':
      return 'Upload cancelled'
    case 'done':
      return null
  }
}
