import type { ServerProbe, VersionInfo } from '../types'
import { ServerError } from './errors'
import type { ClientIdentity } from './identity'
import { createTransport, type Transport } from './transport'

/**
 * What a server says about itself, from the one endpoint that needs nothing.
 *
 * Always the root `/version`, whatever base the rest of the API sits under.
 * This is the call that finds out where that base is, and it has to keep
 * answering the same way for every build that will ever ask — including the
 * ones too old to know an API base exists.
 */
export function getVersionInfo(transport: Transport): Promise<VersionInfo> {
  return transport.request<VersionInfo>('/version')
}

/**
 * Asks a server what it is, before anybody types a password.
 *
 * Unauthenticated on the server's side and deliberately unauthenticated here:
 * this is the call that finds out whether logging in is even possible. Without
 * it an out-of-date desktop would send credentials and get back a rejection it
 * could not explain.
 *
 * Never throws. Every failure is a probe that says what went wrong, because
 * every one of them is something to render in the connect form rather than an
 * exception to handle.
 */
export async function probeServer(
  url: string,
  identity: ClientIdentity,
  options: { fetch?: typeof fetch } = {}
): Promise<ServerProbe> {
  const unreachable = (error: string): ServerProbe => ({
    url,
    reachable: false,
    error,
    serverName: null,
    serverVersion: null,
    apiVersion: null,
    minimumDesktop: null,
    recommendedDesktop: null,
    publicSignup: null,
    compatibility: 'unknown'
  })

  try {
    const version = await getVersionInfo(createTransport({ baseUrl: url, identity, fetch: options.fetch }))

    return {
      url,
      reachable: true,
      error: null,
      serverName: version.serverName,
      serverVersion: version.serverVersion,
      apiVersion: version.apiVersion,
      minimumDesktop: version.minimumDesktop,
      recommendedDesktop: version.recommendedDesktop,
      publicSignup: version.publicSignup,
      compatibility:
        identity.kind === 'desktop'
          ? judge(identity.version, version.minimumDesktop, version.recommendedDesktop)
          : 'unknown'
    }
  } catch (err) {
    if (err instanceof ServerError && err.isUnsupportedClient) {
      // The gate refused even the handshake. Rare — /version is exempt — but a
      // server behind an over-eager proxy could do it, and it still means the
      // same thing.
      return { ...unreachable(err.message), compatibility: 'unsupported' }
    }

    return unreachable(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Where this build stands against a server's stated range.
 *
 * Only advisory. The server's allow list is the authority and it is a set, not
 * a range — a version between the minimum and the newest can still be absent
 * from it — so this decides what to say on the connect screen and never whether
 * to proceed. The real answer comes from the first gated call.
 */
export function judge(mine: string, minimum: string, recommended: string): ServerProbe['compatibility'] {
  const own = parseVersion(mine)
  const min = parseVersion(minimum)
  const rec = parseVersion(recommended)
  if (!own || !min || !rec) return 'unknown'

  if (compare(own, min) < 0) return 'unsupported'
  if (compare(own, rec) < 0) return 'outdated'
  return 'ok'
}

function parseVersion(raw: string): number[] | null {
  const parts = raw.trim().split('.').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  return parts
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
