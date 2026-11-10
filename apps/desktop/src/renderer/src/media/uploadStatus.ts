import type { Recording, RecordingUpload, UploadQueueState } from '@shared/types'
import { isUploadPending } from '@shared/uploadEligibility'

/** Percent of the file the server has, for an upload that knows its size. */
export function uploadPercent(upload: RecordingUpload): number | null {
  if (!upload.fileBytes) return null
  return Math.min(100, Math.floor((upload.bytesSent / upload.fileBytes) * 100))
}

/** Whether an upload of this recording is on its way, in any state that will carry on by itself. */
export function uploadPending(upload: RecordingUpload | null): boolean {
  return isUploadPending(upload)
}

/** Bytes as somebody reads them: 812 MB, 4.2 GB, 512 GB. */
export function formatBytes(bytes: number): string {
  const GB = 1024 ** 3
  const MB = 1024 ** 2
  if (bytes >= 100 * GB) return `${Math.round(bytes / GB)} GB`
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / MB))} MB`
}

/** How long, as somebody reads it: 40 seconds, 12 minutes, 3 h 20 min, 2 days. */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ${minutes % 60} min`
  return `${Math.round(hours / 24)} days`
}

/**
 * A few words on where a recording's upload is up to, or null for nothing to say.
 *
 * The same words in the Recordings tab and over the recording itself, so the
 * two never describe one upload differently.
 */
export function uploadStatusText(recording: Pick<Recording, 'upload' | 'server' | 'fileDeleted'>): string | null {
  const upload = recording.upload
  if (!upload) return recording.server ? 'On the server' : null

  switch (upload.state) {
    case 'queued':
      return upload.resumesAt ? 'Upload waiting to try again' : 'Queued for the server'
    case 'uploading': {
      const percent = uploadPercent(upload)
      return percent === null ? 'Uploading…' : `Uploading ${percent}%`
    }
    case 'paused':
      return upload.error ?? 'Upload paused'
    case 'processing':
      return 'Uploaded — the server is processing it'
    case 'failed':
      return 'Upload failed'
    case 'cancelled':
      return 'Upload cancelled'
    case 'done':
      return recording.fileDeleted ? 'On the server — deleted from this PC' : 'On the server'
  }
}

/** Why the whole queue is holding, in words. */
export function describeQueueHold(hold: NonNullable<UploadQueueState['held']>): string {
  switch (hold) {
    case 'paused':
      return 'Paused.'
    case 'game':
      return 'Waiting for the game to finish.'
    case 'local_only':
      return 'Waiting for this PC to be signed in to a server.'
    case 'no_recordings':
      return 'This server does not keep recordings.'
    case 'other_server':
      return 'Waiting for the server they were queued for.'
    case 'server_full':
      return "The server's video storage is full. Its host has to make room."
  }
}

/** The whole queue in a line, for Settings and the Recordings tab's header. */
export function queueSummary(queue: UploadQueueState): string | null {
  const parts: string[] = []
  if (queue.current) {
    const percent = queue.current.fileBytes ? Math.floor((queue.current.bytesSent / queue.current.fileBytes) * 100) : 0
    parts.push(`Uploading ${percent}%`)
  }
  if (queue.waiting > 0) parts.push(`${queue.waiting} waiting (${formatBytes(queue.remainingBytes)})`)
  if (queue.processing > 0) parts.push(`${queue.processing} processing`)
  if (queue.failed > 0) parts.push(`${queue.failed} failed`)
  if (parts.length === 0) return null
  if (queue.etaSeconds !== null && queue.waiting > 0) parts.push(`about ${formatDuration(queue.etaSeconds)} to go`)
  return parts.join(' · ')
}
