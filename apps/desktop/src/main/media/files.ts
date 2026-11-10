import { rmSync } from 'node:fs'
import { pruneEmptyFolders } from '../capture/fileRecording'
import { getCaptureSettings } from '../services/captureSettings'
import { createLogger } from '../telemetry/logger'

const log = createLogger('recordings')

/**
 * Deletes a recording's file, and the player, game and mode folders it was
 * filed in if it was their last — never the capture folder itself.
 *
 * Shared by deleting a recording by hand and by "delete after upload", so the
 * two leave the disk the same way. Answers whether the file is gone: one a
 * player still has open stays, and the caller keeps the row saying so.
 */
export function deleteRecordingFile(path: string | null): boolean {
  if (!path) return true
  try {
    rmSync(path, { force: true })
  } catch (err) {
    log.debug('Could not delete recording file', { path, error: String(err) })
    return false
  }

  pruneEmptyFolders(getCaptureSettings().folder, path)
  return true
}
