import { getDb } from '../db'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import { nearestZoom } from '@shared/display'
import type { DisplaySettings } from '@shared/types'

const ZOOM = 'display.zoom'

/**
 * How large this PC draws the interface. A preference of the machine rather
 * than of an account or a server — it is about the screen and the person in
 * front of it — so it lives with the other app settings. Applying it to the
 * windows is zoom.ts's; this only remembers it.
 */
export function getDisplaySettings(): DisplaySettings {
  const stored = getSetting(getDb(), ZOOM)
  return { zoom: nearestZoom(stored === null ? null : Number(stored)) }
}

export function setDisplaySettings(patch: Partial<DisplaySettings>): DisplaySettings {
  // Written as text deliberately: a bound number comes back out of the TEXT
  // column as '1.0', and the step it was is then a parse away from lost.
  if (patch.zoom !== undefined) setSetting(getDb(), ZOOM, String(nearestZoom(patch.zoom)))
  return getDisplaySettings()
}
