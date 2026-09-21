import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { FoxfireClient } from '@foxfire/core'
import { AssetManifestProvider } from '@foxfire/ui'
import { ClientProvider, PlatformProvider, useClient, type Platform } from './client/context'
import { useDataEvents } from './client/useDataEvents'
import { queryKeys } from './queries/keys'

/**
 * Everything a screen needs from above it, in one place.
 *
 * The client every read goes through, the platform that says what this machine
 * can do, the asset manifest every icon draws from, and the event subscription
 * that keeps them fresh. The query client is the host app's own and wraps
 * this, because the host decides how long a cache lives.
 */
export function ScreensProvider({
  client,
  platform,
  children
}: {
  client: FoxfireClient
  platform: Platform
  children: ReactNode
}): JSX.Element {
  return (
    <ClientProvider client={client}>
      <PlatformProvider platform={platform}>
        <DataEvents />
        <AssetManifestLoader>{children}</AssetManifestLoader>
      </PlatformProvider>
    </ClientProvider>
  )
}

function DataEvents(): null {
  useDataEvents()
  return null
}

/** Data Dragon manifests change only on patch day, so this is fetched once and kept. */
function AssetManifestLoader({ children }: { children: ReactNode }): JSX.Element {
  const client = useClient()
  const { data } = useQuery({
    queryKey: queryKeys.assets(),
    queryFn: () => client.assets.get(),
    staleTime: Infinity,
    gcTime: Infinity
  })

  return <AssetManifestProvider manifest={data}>{children}</AssetManifestProvider>
}
