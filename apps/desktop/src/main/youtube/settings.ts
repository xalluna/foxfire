import { DEFAULT_TITLE_TEMPLATE } from '@foxfire/core/youtube'
import { getDb } from '../db'
import { getBoolSetting, getSetting, setBoolSetting, setSetting } from '../db/repositories/appSettings.repo'
import type { YouTubePrivacy, YouTubeSettings } from '@shared/types'

/**
 * What this machine does with YouTube, in `app_settings` beside the capture
 * settings and stored the same way: a few rows, read whole, written by patch.
 *
 * The refresh token is not here. It is in the encrypted secret store — see
 * tokens.ts — and nothing that crosses IPC ever carries it.
 */
const KEY = {
  autoUpload: 'youtube.autoUpload',
  defaultPrivacy: 'youtube.defaultPrivacy',
  titleTemplate: 'youtube.titleTemplate',
  email: 'youtube.email',
  quotaResumesAt: 'youtube.quotaResumesAt'
} as const

const PRIVACIES: readonly YouTubePrivacy[] = ['public', 'unlisted', 'private']

export function getYouTubeSettings(): YouTubeSettings {
  const db = getDb()
  const privacy = getSetting(db, KEY.defaultPrivacy) as YouTubePrivacy | null
  return {
    // Off unless somebody turns it on: putting every game on the internet is
    // not a thing to do on anybody's behalf.
    autoUpload: getBoolSetting(db, KEY.autoUpload, false),
    defaultPrivacy: privacy && PRIVACIES.includes(privacy) ? privacy : 'unlisted',
    titleTemplate: getSetting(db, KEY.titleTemplate)?.trim() || DEFAULT_TITLE_TEMPLATE
  }
}

export function setYouTubeSettings(patch: Partial<YouTubeSettings>): YouTubeSettings {
  const db = getDb()
  if (patch.autoUpload !== undefined) setBoolSetting(db, KEY.autoUpload, patch.autoUpload)
  if (patch.defaultPrivacy !== undefined && PRIVACIES.includes(patch.defaultPrivacy)) {
    setSetting(db, KEY.defaultPrivacy, patch.defaultPrivacy)
  }
  if (patch.titleTemplate !== undefined) {
    // Blank means the default, so clearing the box is how to get it back.
    setSetting(db, KEY.titleTemplate, patch.titleTemplate.trim() || null)
  }
  return getYouTubeSettings()
}

/** The Google account uploads go to, as its ID token named it. */
export function getConnectedEmail(): string | null {
  return getSetting(getDb(), KEY.email)
}

export function setConnectedEmail(email: string | null): void {
  setSetting(getDb(), KEY.email, email)
}

/** When YouTube's daily quota comes back, or null when it has not run out. */
export function getQuotaResumesAt(now = Date.now()): number | null {
  const raw = Number(getSetting(getDb(), KEY.quotaResumesAt))
  return Number.isFinite(raw) && raw > now ? raw : null
}

export function setQuotaResumesAt(at: number | null): void {
  setSetting(getDb(), KEY.quotaResumesAt, at === null ? null : String(at))
}
