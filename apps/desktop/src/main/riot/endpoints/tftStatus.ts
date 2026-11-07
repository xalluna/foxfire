import type { TftAccess } from '@foxfire/core'
import { PASSTHROUGH, isNoProductAccess, tftRequest } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'

/**
 * Whether the key TFT is asked through can reach it at all.
 *
 * TFT's cheapest call, made to find out before a sync spends anything: a key
 * registered for League alone answers every TFT endpoint with a 403. Any other
 * failure — the network, a refused key — is not an answer about TFT, and is
 * thrown for the caller to treat as it treats any failed call.
 *
 * Only the main key's 403 is "no TFT". On TFT's own key the same status is the
 * key refused — expired, mistyped, revoked — and telling somebody to go and
 * register a key for TFT would send them to fix the wrong thing.
 */
export async function probeTftAccess(platform: PlatformId): Promise<Exclude<TftAccess, 'unknown'>> {
  const path = '/tft/status/v1/platform-data'
  try {
    await tftRequest(path, platformBaseUrl(platform), path, PASSTHROUGH)
    return 'granted'
  } catch (err) {
    if (isNoProductAccess(err)) return 'denied'
    throw err
  }
}
