import { existsSync } from 'node:fs'
import { getDb } from '../db'
import { getRecordingIdentity } from '../db/repositories/recordings.repo'
import { hasUpload } from '../db/repositories/youtubeUploads.repo'
import { createLogger } from '../telemetry/logger'
import { youtubeClient } from './config'
import { draftFor } from './drafts'
import { enqueue } from './queue'
import { getYouTubeSettings } from './settings'
import { isConnected } from './tokens'

const log = createLogger('youtube')

/**
 * A recording has settled — found its game, or been given up on — and may go
 * to YouTube by itself.
 *
 * Only when somebody turned that on, and only once: a recording already on
 * YouTube, or with an upload of it queued, finished, failed or cancelled, is
 * left to whoever did that. Waiting for the bind is what gets the title its
 * result and KDA; a recording that never finds a game goes up dated instead.
 */
export async function onRecordingSettled(recordingId: number): Promise<void> {
  if (!getYouTubeSettings().autoUpload || !youtubeClient() || !isConnected()) return

  const db = getDb()
  const identity = getRecordingIdentity(db, recordingId)
  if (!identity || identity.youtubeVideoId || identity.fileDeleted || !existsSync(identity.filePath)) return
  if (hasUpload(db, recordingId)) return

  try {
    const draft = await draftFor(recordingId)
    enqueue(
      { recordingId, title: draft.title, description: draft.description, privacy: draft.privacy },
      'auto'
    )
  } catch (err) {
    log.debug('Could not queue an automatic upload', { recordingId, error: String(err) })
  }
}
