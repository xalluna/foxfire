import type { TftAccess } from '@foxfire/core'
import { PASSTHROUGH, isNoProductAccess, tftRequest } from '../client'
import { RiotApiError } from '../rateLimiter'
import { platformBaseUrl, type PlatformId } from '../regions'

/**
 * Whether the key TFT is asked through can reach it at all.
 *
 * TFT's cheapest call, made to find out before a sync spends anything: a key
 * registered for League alone answers every TFT endpoint with a 403. Any other
 * failure — the network, a refused key — is not an answer about TFT, and is
 * thrown for the caller to treat as it treats any failed call.
 */
export async function probeTftAccess(platform: PlatformId): Promise<Exclude<TftAccess, 'unknown'>> {
  const path = '/tft/status/v1/platform-data'
  try {
    await tftRequest(path, platformBaseUrl(platform), path, PASSTHROUGH)
    return 'granted'
  } catch (err) {
    if (isNoProductAccess(err)) return 'denied'
    if (err instanceof RiotApiError && err.status === 403) return 'denied'
    throw err
  }
}
