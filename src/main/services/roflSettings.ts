import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb } from '../db'
import {
  getBoolSetting,
  getSetting,
  setBoolSetting,
  setSetting
} from '../db/repositories/appSettings.repo'
import { getCaptureSettings } from './captureSettings'
import type { RoflSettings } from '@shared/types'

/**
 * Riot replay configuration, stored exactly the way capture settings are — a
 * few rows in app_settings, read whole and written by patch.
 *
 * Two folders matter here and they are easy to confuse. `sourceFolder` is
 * Riot's, which Foxfire only ever reads; `folder` is Foxfire's, where copies
 * are kept. Nothing is written to Riot's folder and nothing is deleted from it.
 */
const KEY = {
  enabled: 'rofl.enabled',
  sourceFolder: 'rofl.sourceFolder',
  folder: 'rofl.folder',
  softCap: 'rofl.softCapBytes'
} as const

/**
 * 5 GB. A .rofl runs 10-20 MB, so this is several hundred games — far more than
 * the recordings cap in count and a fraction of it in bytes. Advisory only:
 * nothing is ever deleted to honour it.
 */
const DEFAULT_SOFT_CAP = 5 * 1024 * 1024 * 1024

/**
 * Where League puts replays when nobody has moved them.
 *
 * More than one candidate, because "Documents" is not a fixed place on Windows.
 * OneDrive redirects it on a great many consumer installs, and — this is the
 * part that makes a single guess dangerous — the original
 * %USERPROFILE%\Documents is left behind and still exists, so an existence
 * check on the parent proves nothing. Guessing once would mean watching an
 * empty directory forever on an entirely ordinary machine, with nothing on
 * screen to say why.
 *
 * Still only a fallback: the client is asked first, because the folder is also
 * configurable inside League itself.
 */
export function defaultSourceFolders(): string[] {
  const leaf = join('League of Legends', 'Replays')
  const roots = [join(homedir(), 'Documents')]

  // Windows sets this when OneDrive is configured, and points it at the right
  // root for both personal and "OneDrive - <org>" business installs.
  const oneDrive = process.env['OneDrive'] ?? process.env['OneDriveConsumer']
  if (oneDrive !== undefined && oneDrive.trim() !== '') {
    roots.push(join(oneDrive, 'Documents'))
  }

  return roots.map((root) => join(root, leaf))
}

/** The one to show when none of them exist yet. */
export function defaultSourceFolder(): string {
  return defaultSourceFolders()[0] as string
}

/**
 * Foxfire's own copies live beside the recordings, not in userData.
 *
 * A subfolder of the capture folder rather than a second configurable path: the
 * user has already answered "which drive has room for game footage" once, and
 * asking again with a second Browse button would be asking them to keep two
 * answers in agreement for no benefit.
 */
export function defaultReplayFolder(): string {
  const capture = getCaptureSettings().folder
  return capture === null ? join(app.getPath('videos'), 'Foxfire', 'Replays') : join(capture, 'Replays')
}

/** Empty means cleared, not absent — the same convention captureSettings uses. */
function text(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The stored settings, without asking the client anything.
 *
 * `resolvedSourceFolder` and `autoRecordEnabled` are filled in by the service
 * layer, which is the only place allowed to talk to the client. Keeping that
 * out of here means settings can be read from anywhere, synchronously, without
 * a network call hiding inside a getter.
 */
export function getRoflSettings(): RoflSettings {
  const db = getDb()
  const softCapRaw = getSetting(db, KEY.softCap)
  const softCap = softCapRaw === null ? DEFAULT_SOFT_CAP : Number(softCapRaw)

  return {
    // On by default. The files are already on disk, the copies are small, and a
    // feature nobody switches on is a feature nobody has.
    //
    // The default goes in the call. getBoolSetting resolves an unset key to its
    // fallback and returns a plain boolean, so `?? true` after it never fires —
    // it reads like a default and silently gives you `false`.
    enabled: getBoolSetting(db, KEY.enabled, true),
    sourceFolder: text(getSetting(db, KEY.sourceFolder)),
    resolvedSourceFolder: null,
    autoRecordEnabled: null,
    folder: text(getSetting(db, KEY.folder)) ?? defaultReplayFolder(),
    softCapBytes: Number.isFinite(softCap) && softCap >= 0 ? softCap : DEFAULT_SOFT_CAP
  }
}

export function setRoflSettings(patch: Partial<RoflSettings>): RoflSettings {
  const db = getDb()

  if (patch.enabled !== undefined) setBoolSetting(db, KEY.enabled, patch.enabled)
  if (patch.sourceFolder !== undefined) setSetting(db, KEY.sourceFolder, patch.sourceFolder ?? '')
  if (patch.folder !== undefined) setSetting(db, KEY.folder, patch.folder ?? '')
  if (patch.softCapBytes !== undefined) {
    setSetting(db, KEY.softCap, String(Math.max(0, Math.round(patch.softCapBytes))))
  }

  return getRoflSettings()
}
