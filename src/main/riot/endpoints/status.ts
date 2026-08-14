import { riotFetch } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'

/**
 * Cheapest authenticated call available — used purely to confirm a pasted API
 * key is live before we persist it, so the user finds out immediately rather
 * than on their first real lookup.
 */
export async function checkPlatformStatus(platform: PlatformId): Promise<void> {
  await riotFetch<unknown>(platformBaseUrl(platform), '/lol/status/v4/platform-data')
}
