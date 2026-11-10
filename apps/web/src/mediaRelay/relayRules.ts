/**
 * The relay's rules, pure, so they are tested without a page.
 *
 * The relay is what lets the desktop play a recording. Foxfire Media's player
 * may only be framed by, and only takes commands from, the origins its
 * application lists — this server's. The desktop's window is a file:// page,
 * which can be neither. So the desktop frames this page, on this server's
 * origin, and this page frames the player and carries Foxfire Media's own
 * messages between the two, unchanged: the desktop speaks the same protocol
 * here as a browser speaks to Foxfire Media directly.
 */

/**
 * The embed to frame, from the page's fragment.
 *
 * A fragment rather than a query: an embed URL is good for loading one video,
 * and a fragment never leaves the browser — it is not in this server's request
 * log, or a proxy's. Only an http(s) URL is taken. Which origin it may be is
 * the page's CSP's to say (frame-src is Foxfire Media's alone), so a URL
 * somewhere else is refused by the browser even if it got this far.
 */
export function embedFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (raw === '') return null

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }

  try {
    const url = new URL(decoded)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** One of Foxfire Media's control messages — the only thing the relay carries either way. */
export function isPlayerMessage(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const message = data as { foxfire?: unknown; type?: unknown }
  return (
    message.foxfire === 1 &&
    typeof message.type === 'string' &&
    ['hello', 'command', 'connected', 'event', 'response'].includes(message.type)
  )
}

/** Which way a message goes, or nowhere. */
export function routeMessage(
  event: { source: unknown; origin: string; data: unknown },
  frames: { parent: unknown; player: unknown; playerOrigin: string }
): 'toPlayer' | 'toParent' | null {
  if (!isPlayerMessage(event.data)) return null
  if (event.source === frames.parent) return 'toPlayer'
  if (event.source === frames.player && event.origin === frames.playerOrigin) return 'toParent'
  return null
}
