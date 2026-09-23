/**
 * Turning what somebody typed into a server address, or refusing to.
 *
 * Pure, and separate from the fetching for that reason: this is the rule about
 * what Foxfire will talk to, and a rule worth testing exhaustively is worth
 * keeping away from anything that touches a network.
 *
 * The rule is https, with localhost excepted. A Foxfire session carries a
 * password on the way in and a long-lived token forever after, and a
 * self-hoster is expected to put a reverse proxy in front of their server to
 * get a certificate anyway — the server's own Dockerfile assumes it. Allowing
 * plain http "just for the LAN" would mean the one setting nobody revisits is
 * the one that matters the first time somebody forwards a port.
 */

export interface NormalisedUrl {
  /** The address to use, with no trailing slash. */
  url: string
}

export interface UrlProblem {
  error: string
}

/** Loopback is the exception, because there is no wire for anybody to listen on. */
function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/**
 * Accepts what a person would paste and returns what to connect to.
 *
 * A bare `foxfire.example.com` becomes https, because that is what somebody
 * copying an address out of a Discord message means and asking them to type a
 * scheme teaches them nothing. A bare `localhost:8080` becomes http for the
 * same reason — nobody runs a certificate on their own machine to try
 * something out.
 */
export function normaliseServerUrl(raw: string): NormalisedUrl | UrlProblem {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { error: 'Enter the address of a Foxfire server.' }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
  const looksLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(trimmed)
  const withScheme = hasScheme ? trimmed : `${looksLocal ? 'http' : 'https'}://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return { error: `That is not an address: "${trimmed}"` }
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'A Foxfire server address starts with https://' }
  }

  if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
    return {
      error:
        'That address is not https. Your password and the token that keeps you signed in travel ' +
        'over this connection, so Foxfire will only use http for a server on this machine.'
    }
  }

  if (!parsed.hostname) return { error: `That address has no host: "${trimmed}"` }

  // Everything after the host is dropped. A server lives at the root of its
  // origin, and keeping a path somebody pasted from a link — /invite/… most
  // likely — would send every request somewhere that does not answer.
  return { url: `${parsed.protocol}//${parsed.host}` }
}

/**
 * Pulls the code out of whatever the user pasted — an invite, or a password
 * reset.
 *
 * They are handed a link and told to paste a code, so they will paste both, in
 * either order, and sometimes with the angle brackets a chat client wrapped it
 * in. Taking the last path segment of anything that parses as a URL, and the
 * trimmed string otherwise, covers all of it. Nothing here is particular to
 * either kind of link, which is why both use it.
 */
export function tokenFromLink(pasted: string): string {
  const trimmed = (pasted ?? '').trim().replace(/^<|>$/g, '')
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    const last = url.pathname.split('/').filter(Boolean).pop()
    return last ?? ''
  } catch {
    return trimmed
  }
}

/** What the desktop shows for a server before it has a name of its own. */
export function displayName(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
