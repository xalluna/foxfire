import { mountFoxfirePlayer, type MediaMount } from '@foxfire/ui'

/**
 * Foxfire Media's player, framed straight into the page.
 *
 * A browser can: this page is on the server's own origin, which is the one
 * Foxfire Media's application lists, so the player may be framed here and
 * takes commands from here. The page's CSP allows exactly that frame — see
 * SpaHosting.cs. (The desktop cannot, and goes through the server's relay page.)
 */
export function createWebMediaMount(): MediaMount {
  return (container, embedUrl) => mountFoxfirePlayer(container, embedUrl, new URL(embedUrl).origin)
}
