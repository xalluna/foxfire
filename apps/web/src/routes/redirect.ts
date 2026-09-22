/** Stands in for this site's origin while an address is resolved; never contacted. */
const HERE = 'https://foxfire.invalid'

/**
 * Where to go after signing in, from the `redirect` a sign-in link carries.
 *
 * Only ever a page on this site. A redirect taken as written would let a link
 * to this server's own sign-in page send somebody, freshly signed in and
 * trusting it, anywhere at all.
 *
 * Checked by resolving it the way a browser will rather than by looking at its
 * first characters, because a browser is more forgiving than a prefix check:
 * it reads `/\evil.example` as `//evil.example`, and drops tabs and newlines
 * before it reads anything. What comes back is the resolved path, so the page
 * navigated to is the one that was checked.
 */
export function safeRedirect(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return fallback

  let url: URL
  try {
    url = new URL(raw, HERE)
  } catch {
    return fallback
  }

  if (url.origin !== HERE) return fallback
  // Back to the sign-in page would only land here again.
  if (url.pathname === '/sign-in') return fallback

  return `${url.pathname}${url.search}${url.hash}`
}
