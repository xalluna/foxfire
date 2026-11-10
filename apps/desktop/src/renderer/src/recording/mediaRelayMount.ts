import { mountFoxfirePlayer, type MediaMount } from '@foxfire/ui'
import type { Api } from '@shared/api'
import type { ServerState } from '@shared/types'

/**
 * Foxfire Media's player, framed through the server's relay page.
 *
 * Not directly, as a browser does: this window is a file:// page, and Foxfire
 * Media's player is framed only by — and takes commands only from — the
 * origins its application lists, which is the server's. So this frames
 * `/media-relay` on the server, which frames the player and carries its
 * control messages both ways unchanged; the shared controller speaks the very
 * protocol it would to Foxfire Media, to the relay's origin. (Main lets this
 * window frame the player at all — see main/media/embedHeaders.ts.)
 *
 * The server's public address rather than the one this PC connected with:
 * Foxfire Media lists the address members reach the server at, and a PC on
 * the server's own network may well connect by another. The embed URL rides in
 * the fragment, which never leaves this machine.
 */
export function createRelayMount(api: Api): MediaMount {
  let origin: string | null = null
  const follow = (state: ServerState): void => {
    const address = state.publicUrl ?? state.activeUrl
    try {
      origin = address ? new URL(address).origin : null
    } catch {
      origin = null
    }
  }
  void api.server.getState().then(follow)
  api.server.onChanged(follow)

  return (container, embedUrl) => {
    if (!origin) throw new Error('This PC is not signed in to a server.')
    return mountFoxfirePlayer(container, `${origin}/media-relay#${encodeURIComponent(embedUrl)}`, origin)
  }
}
