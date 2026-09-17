import { useQuery } from '@tanstack/react-query'
import type { AssetManifest } from '@shared/types'

/** Data Dragon manifests change only on patch day, so cache them for the session. */
export function useAssets(): AssetManifest | undefined {
  const { data } = useQuery({
    queryKey: ['assets'],
    queryFn: () => window.api.assets.get(),
    staleTime: Infinity,
    gcTime: Infinity
  })
  return data
}
