import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getBoolSetting, getSetting, setBoolSetting, setSetting } from '../db/repositories/appSettings.repo'
import { getDb } from '../db'
import { clearSecret, hasSecret, loadSecret, saveSecret } from '../security/keyStore'
import type { CaptureAudio, CaptureSettings, ObsMode } from '@shared/types'
import { DEFAULT_CAPTURE_QUALITY, type CaptureQuality } from '@shared/captureQuality'

/**
 * Capture configuration, stored the same way the background settings are — a
 * handful of rows in `app_settings`, read whole and written by patch.
 *
 * The obs-websocket password is the one exception: it lives in the encrypted
 * secret store beside the Riot key and never appears in the object this module
 * returns, only as `hasObsPassword`.
 */
const KEY = {
  enabled: 'capture.enabled',
  mode: 'capture.mode',
  folder: 'capture.folder',
  queues: 'capture.queues',
  otherQueues: 'capture.otherQueues',
  audio: 'capture.audio',
  quality: 'capture.quality',
  softCap: 'capture.softCapBytes',
  obsHost: 'capture.obsHost',
  obsPort: 'capture.obsPort',
  obsInstallPath: 'capture.obsInstallPath',
  obsScene: 'capture.obsScene'
} as const

/** The obs-websocket password's name in the secret store. */
export const OBS_PASSWORD_SECRET = 'obs-websocket-password'

/** obs-websocket's own default port since OBS 28 bundled it. */
const DEFAULT_PORT = 4455

/** Solo/Duo and Flex — the games most worth reviewing, and a modest default disk cost. */
const DEFAULT_QUEUES = [420, 440]

/** 50 GB. Advisory only; nothing is ever deleted to honour it. */
const DEFAULT_SOFT_CAP = 50 * 1024 * 1024 * 1024

/**
 * Videos, never userData.
 *
 * %APPDATA% sits on the system drive, which is the last place anybody wants a
 * hundred gigabytes of gameplay footage to accumulate.
 */
function defaultFolder(): string {
  return join(app.getPath('videos'), 'Foxfire')
}

/** What defaultFolder() returned while the app was called LoL Stats. */
function legacyDefaultFolder(): string {
  return join(app.getPath('videos'), 'LoL Stats')
}

/**
 * Pins the old default so the rename does not orphan existing recordings.
 *
 * This default is resolved on every read and never stored, so changing the
 * constant silently repoints the app at a new directory — while
 * recordingProtocol.ts refuses to serve any file outside the *current* folder and
 * the recordings table goes on holding absolute paths into the old one. The result
 * would be a Recordings tab where every existing recording claims to have been
 * moved or deleted.
 *
 * Writing the resolved old path into the setting makes the previous default
 * explicit, which is what it should have been all along. Anyone who picked a
 * folder by hand already has the row and is untouched; a genuinely new install
 * has no such directory and gets Videos/Foxfire.
 */
export function pinLegacyCaptureFolder(): void {
  const db = getDb()
  if (text(getSetting(db, KEY.folder)) !== null) return

  const legacy = legacyDefaultFolder()
  if (!existsSync(legacy)) return

  setSetting(db, KEY.folder, legacy)
}

/**
 * An empty stored value means "cleared", not "empty string".
 *
 * Clearing a path writes '' rather than deleting the row, and `??` does not
 * catch that — so the default would never come back. Same normalisation the
 * live-client mapping does for names the game reports blank.
 */
function text(raw: string | null): string | null {
  return raw === null || raw.trim() === '' ? null : raw
}

function readNumber(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readQueues(raw: string | null): number[] {
  if (raw === null) return [...DEFAULT_QUEUES]
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_QUEUES]
    return parsed.filter((value): value is number => typeof value === 'number')
  } catch {
    return [...DEFAULT_QUEUES]
  }
}

export function getCaptureSettings(): CaptureSettings {
  const db = getDb()

  return {
    enabled: getBoolSetting(db, KEY.enabled, false),
    mode: (text(getSetting(db, KEY.mode)) as ObsMode | null) ?? 'managed',
    folder: text(getSetting(db, KEY.folder)) ?? defaultFolder(),
    queues: readQueues(text(getSetting(db, KEY.queues))),
    otherQueues: getBoolSetting(db, KEY.otherQueues, false),
    audio: (text(getSetting(db, KEY.audio)) as CaptureAudio | null) ?? 'game',
    quality:
      (text(getSetting(db, KEY.quality)) as CaptureQuality | null) ?? DEFAULT_CAPTURE_QUALITY,
    softCapBytes: readNumber(text(getSetting(db, KEY.softCap)), DEFAULT_SOFT_CAP),
    obsHost: text(getSetting(db, KEY.obsHost)) ?? '127.0.0.1',
    obsPort: readNumber(text(getSetting(db, KEY.obsPort)), DEFAULT_PORT),
    hasObsPassword: hasSecret(OBS_PASSWORD_SECRET),
    obsInstallPath: text(getSetting(db, KEY.obsInstallPath)),
    obsScene: text(getSetting(db, KEY.obsScene))
  }
}

/**
 * Writes only the keys present in the patch and returns the whole fresh object,
 * the same contract `setBackgroundSettings` uses so the renderer can drop the
 * result straight into its query cache.
 */
export function setCaptureSettings(patch: Partial<CaptureSettings>): CaptureSettings {
  const db = getDb()

  if (patch.enabled !== undefined) setBoolSetting(db, KEY.enabled, patch.enabled)
  if (patch.mode !== undefined) setSetting(db, KEY.mode, patch.mode)
  if (patch.folder !== undefined) setSetting(db, KEY.folder, patch.folder ?? '')
  if (patch.queues !== undefined) setSetting(db, KEY.queues, JSON.stringify(patch.queues))
  if (patch.otherQueues !== undefined) setBoolSetting(db, KEY.otherQueues, patch.otherQueues)
  if (patch.audio !== undefined) setSetting(db, KEY.audio, patch.audio)
  if (patch.quality !== undefined) setSetting(db, KEY.quality, patch.quality)
  if (patch.softCapBytes !== undefined) setSetting(db, KEY.softCap, String(patch.softCapBytes))
  if (patch.obsHost !== undefined) setSetting(db, KEY.obsHost, patch.obsHost)
  if (patch.obsPort !== undefined) setSetting(db, KEY.obsPort, String(patch.obsPort))
  if (patch.obsInstallPath !== undefined) {
    setSetting(db, KEY.obsInstallPath, patch.obsInstallPath ?? '')
  }
  if (patch.obsScene !== undefined) setSetting(db, KEY.obsScene, patch.obsScene ?? '')

  return getCaptureSettings()
}

export function setObsPassword(password: string): CaptureSettings {
  saveSecret(OBS_PASSWORD_SECRET, password)
  return getCaptureSettings()
}

export function clearObsPassword(): CaptureSettings {
  clearSecret(OBS_PASSWORD_SECRET)
  return getCaptureSettings()
}

/** Main-process only — this is the one place the password is read back. */
export function getObsPassword(): string {
  return loadSecret(OBS_PASSWORD_SECRET) ?? ''
}
