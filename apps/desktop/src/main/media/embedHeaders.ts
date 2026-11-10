import { session } from 'electron'
import { getServerState, onServerState } from '../services/serverService'
import { createLogger } from '../telemetry/logger'
import { withoutFrameAncestors } from './embedPolicy'

const log = createLogger('media')

/**
 * Lets this app's own windows frame Foxfire Media's player.
 *
 * Foxfire Media sends its player with a CSP whose frame-ancestors names its
 * application's origins — the server's — and the browser checks every frame
 * above the player against it. A recording window here is a file:// page,
 * which no frame-ancestors can name; it frames the server's relay page, which
 * frames the player, and the file:// page at the top would still fail the
 * check. So, in this app's own session and for the player's pages alone, that
 * one directive comes off. The relay is on the server's origin, which is what
 * the player's control API checks, so commands still only reach it from there.
 *
 * Nothing else about the page changes, and nothing changes for any browser:
 * this is this app deciding what its own windows may frame.
 */

let installedFor: string | null = null

function install(origin: string | null): void {
  if (origin === installedFor) return
  installedFor = origin

  const requests = session.defaultSession.webRequest
  if (origin === null) {
    requests.onHeadersReceived(null)
    return
  }

  requests.onHeadersReceived({ urls: [`${origin}/embed/*`] }, (details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) }
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() !== 'content-security-policy') continue
      headers[name] = (headers[name] ?? []).map(withoutFrameAncestors)
    }
    callback({ responseHeaders: headers })
  })
  log.info('Recordings play from Foxfire Media', { origin })
}

/** Follows the active server's Foxfire Media, wherever it is. */
export function installEmbedHeaders(): void {
  install(getServerState().mediaOrigin)
  onServerState((state) => install(state.mediaOrigin))
}
