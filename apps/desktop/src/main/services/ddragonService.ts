import { buildAssetManifest } from '@foxfire/core/ddragon'
import type { AssetManifest } from '@shared/types'

let cached: AssetManifest | null = null
let inFlight: Promise<AssetManifest> | null = null

/**
 * The asset manifest, built once per run.
 *
 * Built here rather than in the renderer because the renderer's policy has no
 * connect-src at all: it can load Data Dragon's images but cannot fetch its
 * JSON, and that is a line worth keeping. The building is @foxfire/core's.
 *
 * Cached for the process lifetime — patch changes are rare enough to not warrant invalidation.
 */
export function getAssetManifest(): Promise<AssetManifest> {
  if (cached) return Promise.resolve(cached)
  if (!inFlight) {
    inFlight = buildAssetManifest()
      .then((manifest) => {
        cached = manifest
        return manifest
      })
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}
