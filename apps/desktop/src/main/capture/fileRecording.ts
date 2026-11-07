import { existsSync, mkdirSync, renameSync, rmdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  getRecordingPlacementFacts,
  isRecordingPathTaken,
  updateRecordingFilePath
} from '../db/repositories/recordings.repo'
import { createLogger } from '../telemetry/logger'
import { foldersBetween, isUnder, plannedRecordingPath, withCollisionSuffix } from './recordingLayout'

const log = createLogger('capture')

/** How long to wait before trying a move again that the file being open refused. */
const RETRY_AFTER_MS = 2_000

/** The errors Windows gives a move while something still has the file open — OBS finishing, a virus scan. */
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES'])

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code

/**
 * Moves a finished recording into its place under the capture folder, and
 * says where the file is now.
 *
 * Only a file OBS wrote into the folder itself is moved; one somewhere else —
 * a folder OBS was pointed at by hand — stays where the person put it. A move
 * the file being open refuses is tried once more a moment later, the row
 * catching up if it lands; any other failure leaves the file where OBS wrote
 * it, which is still a recording that plays.
 *
 * `onMovedLater` is told when a retried move lands, so whatever shows the path
 * can show the new one.
 */
export function fileFinishedRecording(
  db: DatabaseSync,
  recordingId: number,
  path: string,
  root: string | null,
  onMovedLater: () => void = () => {}
): string {
  if (!root || !isUnder(root, path)) {
    log.debug('Recording left where it was written: outside the capture folder', { recordingId, path })
    return path
  }

  const facts = getRecordingPlacementFacts(db, recordingId)
  if (!facts) return path

  const planned = plannedRecordingPath({ root, sourcePath: path, ...facts })
  if (planned === path) return path

  const target = withCollisionSuffix(planned, (p) => existsSync(p) || isRecordingPathTaken(db, p, recordingId))

  try {
    mkdirSync(dirname(target), { recursive: true })
    renameSync(path, target)
    log.info('Recording filed', { recordingId, path: target })
    return target
  } catch (err) {
    if (!BUSY.has(codeOf(err) ?? '')) {
      log.warn('Could not file a recording; left where it was written', { recordingId, path, error: String(err) })
      return path
    }

    setTimeout(() => {
      try {
        renameSync(path, target)
        updateRecordingFilePath(db, recordingId, target)
        log.info('Recording filed on a second try', { recordingId, path: target })
        onMovedLater()
      } catch (retryErr) {
        log.warn('Could not file a recording; left where it was written', {
          recordingId,
          path,
          error: String(retryErr)
        })
      }
    }, RETRY_AFTER_MS).unref?.()

    return path
  }
}

/**
 * Removes the folders a deleted recording leaves empty, from its own up to —
 * never including — the capture folder, stopping at the first that still holds
 * something. Never fails: an empty folder left behind is untidy, not wrong.
 */
export function pruneEmptyFolders(root: string | null | undefined, deletedPath: string): void {
  if (!root) return
  for (const folder of foldersBetween(root, deletedPath)) {
    try {
      rmdirSync(folder)
    } catch {
      return
    }
  }
}
