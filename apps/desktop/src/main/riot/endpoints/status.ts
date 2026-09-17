import { PASSTHROUGH, riotRequest } from '../client'
import { platformBaseUrl, type PlatformId } from '../regions'

/**
 * Cheapest authenticated call available — used purely to confirm a pasted API
 * key is live before we persist it, so the user finds out immediately rather
 * than on their first real lookup.
 */
export async function checkPlatformStatus(platform: PlatformId): Promise<void> {
  const path = '/lol/status/v4/platform-data'
  // The body is never read, so there is nothing to validate — but the call
  // still goes through riotRequest so key checks appear in telemetry alongside
  // everything else.
  await riotRequest(path, platformBaseUrl(platform), path, PASSTHROUGH)
}
