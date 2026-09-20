import { watch, type FSWatcher } from 'node:fs'
import { createLogger } from '../telemetry/logger'
import { scanReplayFolder } from '../services/replayService'
import { resolveSourceFolder } from '../services/clientArchiveService'
import { getRoflSettings } from '../services/roflSettings'

/**
 * Noticing when Riot writes a replay.
 *
 * Two mechanisms, because neither is sufficient alone. fs.watch reports changes
 * promptly but is not something to stake a feature on — it is quietly
 * unreliable across network drives and folders that get replaced wholesale, and
 * it reports nothing at all about the state of the world when the app was
 * closed. So the watcher handles "a replay just arrived" and explicit scans
 * handle everything else: at launch, after every game, and whenever the user
 * asks.
 *
 * There is no settle timer. A .rofl grows on disk while the client downloads
 * it, and a partial file has no readable header — so the ingest step's header
 * parse already answers "is this finished", and a file caught mid-write is
 * simply picked up by the next scan. One check, doing one job.
 */

const log = createLogger('rofl')

/**
 * How long to wait after a change before scanning.
 *
 * fs.watch fires several times for one file as it is created, written and
 * closed. Coalescing keeps that from becoming several scans, and the delay
 * gives a small download time to finish so the usual case succeeds on the
 * first attempt rather than the second.
 */
const SETTLE_MS = 4000

let watcher: FSWatcher | null = null
let pending: NodeJS.Timeout | null = null
let watchedFolder: string | null = null

export async function startReplayWatcher(): Promise<void> {
  stopReplayWatcher()

  const settings = getRoflSettings()
  if (!settings.enabled) return

  const folder = await resolveSourceFolder(settings.sourceFolder)
  if (folder === null) {
    log.debug('No replay folder to watch yet')
    return
  }

  try {
    watcher = watch(folder, { persistent: false }, (_event, fileName) => {
      if (typeof fileName === 'string' && !fileName.toLowerCase().endsWith('.rofl')) return
      schedule()
    })
    watchedFolder = folder
    log.info('Watching the replay folder', { folder })
  } catch (err) {
    // A folder that does not exist yet is the ordinary case for somebody who
    // has never saved a replay. The scans will still find it once it does.
    log.debug('Could not watch the replay folder', { folder, error: String(err) })
  }
}

export function stopReplayWatcher(): void {
  if (pending !== null) {
    clearTimeout(pending)
    pending = null
  }
  if (watcher !== null) {
    watcher.close()
    watcher = null
  }
  watchedFolder = null
}

/** Which folder is actually being watched, so Settings can say. */
export function watchedReplayFolder(): string | null {
  return watchedFolder
}

function schedule(): void {
  if (pending !== null) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    void scanReplayFolder().catch((err: unknown) => {
      log.debug('A watched scan failed', { error: String(err) })
    })
  }, SETTLE_MS)
  pending.unref()
}

/**
 * A scan prompted by something other than a file change — launch, a finished
 * game, or the user asking. Never throws: none of its callers can do anything
 * useful about a failure, and all of them have other work to get on with.
 */
export async function rescanReplays(options: { announce?: boolean } = {}): Promise<number> {
  try {
    return await scanReplayFolder(options)
  } catch (err) {
    log.debug('A replay scan failed', { error: String(err) })
    return 0
  }
}
