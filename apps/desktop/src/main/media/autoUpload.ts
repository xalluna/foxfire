import { getDb } from '../db'
import { getRecordingIdentity } from '../db/repositories/recordings.repo'
import { hasUpload } from '../db/repositories/mediaUploads.repo'
import { getServerState, isServerMode } from '../services/serverService'
import { createLogger } from '../telemetry/logger'
import { enqueue } from './queue'
import { getMediaSettings } from './settings'

const log = createLogger('media')

/**
 * A recording has settled — found its game, or been given up on — and may go
 * to the server by itself.
 *
 * Only when somebody turned that on, only on a server that keeps recordings,
 * and only once: a recording already there, or with an upload of it queued,
 * finished, failed or cancelled, is left to whoever did that. Silently — no
 * dialog, nothing to click — and only after the game: settling waits for the
 * game to bind, which is what gets the title its result, and the queue holds
 * while the next one is on anyway.
 *
 * A recording that never found its game is not sent: the server keeps a
 * recording against its game, and has nowhere to put one without.
 */
export function onRecordingSettled(recordingId: number): void {
  if (!getMediaSettings().autoUpload || !isServerMode() || !getServerState().recordings) return

  const db = getDb()
  const identity = getRecordingIdentity(db, recordingId)
  if (!identity?.matchId || identity.fileDeleted || identity.serverVideoId) return
  if (hasUpload(db, recordingId)) return

  const result = enqueue([recordingId], 'auto')
  if (result.queued === 0) {
    log.debug('An automatic upload was not queued', { recordingId, reason: result.skipped[0]?.reason })
  }
}
