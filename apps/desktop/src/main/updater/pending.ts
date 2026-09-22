import { getDb } from '../db'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'

/** An update downloaded and waiting for the app to close. */
const PENDING_SETTING = 'update.pending'

/** What the build now running arrived with, for the About page to show. */
const NOTES_SETTING = 'update.notes'

export interface PendingInstall {
  version: string
  /** That version's changelog section, carried in `latest.yml`. */
  notes: string | null
  /** Whether the window was hidden when the restart was asked for. */
  relaunchHidden: boolean
}

/**
 * Why any of this is written down rather than held in memory.
 *
 * The installer restarts the app, and the process that comes back knows only
 * what it can read off the disk: NSIS relaunches the app with `--updated` and
 * nothing else, so there is no argument to carry the version it just installed,
 * what that version changed, or whether the copy that asked for the restart was
 * sitting in the tray at the time. All three have to outlive the process, and
 * the app already has a key/value table for facts of exactly this weight.
 */
export function setPendingInstall(pending: PendingInstall): void {
  setSetting(getDb(), PENDING_SETTING, JSON.stringify(pending))
}

/** Records where the window was, at the moment the restart was asked for. */
export function markRelaunchHidden(hidden: boolean): void {
  const pending = readPending()
  if (!pending) return
  setPendingInstall({ ...pending, relaunchHidden: hidden })
}

/**
 * The update that has just been installed, if this launch is that restart.
 *
 * Always clears the record, whatever it said. A pending install naming a
 * version other than the one now running means the install did not happen —
 * the user declined an elevation prompt, or installed something else by hand —
 * and keeping it would make every later launch claim to have just updated.
 *
 * The notes are kept behind, under the version they describe, so the About page
 * can still answer "what's new" tomorrow.
 */
export function takeCompletedInstall(currentVersion: string): PendingInstall | null {
  const pending = readPending()
  setSetting(getDb(), PENDING_SETTING, null)

  if (!pending || pending.version !== currentVersion) return null

  setSetting(
    getDb(),
    NOTES_SETTING,
    JSON.stringify({ version: pending.version, notes: pending.notes })
  )
  return pending
}

/** What the running build arrived with, or null if it was installed by hand. */
export function notesFor(version: string): string | null {
  const raw = getSetting(getDb(), NOTES_SETTING)
  if (!raw) return null

  try {
    const stored = JSON.parse(raw) as { version?: unknown; notes?: unknown }
    if (stored.version !== version) return null
    return typeof stored.notes === 'string' ? stored.notes : null
  } catch {
    return null
  }
}

function readPending(): PendingInstall | null {
  const raw = getSetting(getDb(), PENDING_SETTING)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PendingInstall>
    if (typeof parsed.version !== 'string') return null
    return {
      version: parsed.version,
      notes: typeof parsed.notes === 'string' ? parsed.notes : null,
      relaunchHidden: parsed.relaunchHidden === true
    }
  } catch {
    // A hand-edited or truncated row should cost the note, not the launch.
    return null
  }
}
