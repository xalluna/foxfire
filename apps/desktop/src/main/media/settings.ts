import { DEFAULT_TFT_TITLE_TEMPLATE, DEFAULT_TITLE_TEMPLATE } from '@foxfire/core/recordings'
import { getDb } from '../db'
import { getBoolSetting, getSetting, setBoolSetting, setSetting } from '../db/repositories/appSettings.repo'
import type { MediaSettings } from '@shared/types'

/**
 * What this machine does with recordings and the server, in `app_settings`
 * beside the capture settings and stored the same way: a few rows, read whole,
 * written by patch.
 */
const KEY = {
  autoUpload: 'media.autoUpload',
  afterUpload: 'media.afterUpload',
  titleTemplate: 'media.titleTemplate',
  tftTitleTemplate: 'media.tftTitleTemplate'
} as const

export function getMediaSettings(): MediaSettings {
  const db = getDb()
  return {
    // Off unless somebody turns it on: sending every game to a server is not a
    // thing to do on anybody's behalf, and nor is deleting what was recorded.
    autoUpload: getBoolSetting(db, KEY.autoUpload, false),
    afterUpload: getSetting(db, KEY.afterUpload) === 'delete' ? 'delete' : 'keep',
    titleTemplate: getSetting(db, KEY.titleTemplate)?.trim() || DEFAULT_TITLE_TEMPLATE,
    tftTitleTemplate: getSetting(db, KEY.tftTitleTemplate)?.trim() || DEFAULT_TFT_TITLE_TEMPLATE
  }
}

export function setMediaSettings(patch: Partial<MediaSettings>): MediaSettings {
  const db = getDb()
  if (patch.autoUpload !== undefined) setBoolSetting(db, KEY.autoUpload, patch.autoUpload)
  if (patch.afterUpload === 'keep' || patch.afterUpload === 'delete') setSetting(db, KEY.afterUpload, patch.afterUpload)
  if (patch.titleTemplate !== undefined) {
    // Blank means the default, so clearing the box is how to get it back.
    setSetting(db, KEY.titleTemplate, patch.titleTemplate.trim() || null)
  }
  if (patch.tftTitleTemplate !== undefined) {
    setSetting(db, KEY.tftTitleTemplate, patch.tftTitleTemplate.trim() || null)
  }
  return getMediaSettings()
}
