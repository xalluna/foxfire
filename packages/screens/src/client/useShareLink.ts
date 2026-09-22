import { useMemo } from 'react'
import { absoluteUrl } from '@foxfire/core/routes'
import { usePlatform } from './context'
import { useConnection } from './useConnection'

/** Copies a link to a path in the server's web client. */
export type ShareLink = (path: string) => Promise<void>

/**
 * "Copy link", when there is somewhere for a link to point.
 *
 * A link opens in the web client of the server the data came from, so there is
 * none in local-only mode and none from a server too old to say where its web
 * client lives — and then this is null, and every "Copy link" is hidden rather
 * than offering one that leads nowhere.
 *
 * Built on the address the server advertises, never on the one this client
 * connected with: a desktop may reach its server by a LAN name that nobody the
 * link is sent to could open. Paths come from @foxfire/core's `paths`, which
 * the web client's routes read — see routes.test.ts in this package.
 */
export function useShareLink(): ShareLink | null {
  const connection = useConnection()
  const platform = usePlatform()
  const publicUrl = connection?.mode === 'server' ? connection.publicUrl : null

  return useMemo(
    () => (publicUrl ? (path: string) => platform.copyText(absoluteUrl(publicUrl, path)) : null),
    [publicUrl, platform]
  )
}
