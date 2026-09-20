import { app } from 'electron'
import type { ServerProbe } from '@shared/types'

/** What the desktop tells a server it is. The server's allow list judges it. */
export const CLIENT_VERSION_HEADER = 'X-Foxfire-Client'

/** Set by a server that will serve this build but would rather serve a newer one. */
const UPGRADE_HEADER = 'x-foxfire-upgrade-available'

/**
 * Long enough for a homelab on a domestic connection, short enough that a
 * server which has gone away does not leave a spinner running for a minute.
 */
const TIMEOUT_MS = 15_000

/** A server answered, and the answer was no. */
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's own error code, when it sent one — `invite_required` and so on. */
    readonly code: string | null = null,
    /**
     * Set on a 426. The version this server wants, so the desktop can name it
     * rather than saying something went wrong.
     */
    readonly upgradeTo: string | null = null
  ) {
    super(message)
    this.name = 'ServerError'
  }

  /** This build is not one the server will talk to at all. */
  get isUnsupportedClient(): boolean {
    return this.status === 426
  }

  /** The access token is missing, expired, or no longer means anything. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  /** Sent as a bearer token when present. */
  accessToken?: string | null
  signal?: AbortSignal
}

/**
 * One call to a Foxfire server.
 *
 * Every request carries the desktop's version, including the unauthenticated
 * ones, because the server decides what it will talk to before it decides who
 * is talking. A 426 comes back as a ServerError that names the version to
 * install — with no auto-update on this side yet, that string is the whole of
 * what a stranded user has to go on.
 *
 * Errors are the server's own shape (`{ error, message }`) where it sent one,
 * so the message shown is the one the server wrote rather than a status code
 * translated twice.
 */
export async function serverRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const headers: Record<string, string> = {
    [CLIENT_VERSION_HEADER]: app.getVersion(),
    Accept: 'application/json'
  }

  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`

  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    // No answer at all: wrong address, server down, DNS, a certificate the
    // system does not trust. Status 0 marks it as never having reached one.
    throw new ServerError(describeNetworkFailure(err, baseUrl), 0)
  }

  if (!response.ok) throw await describeFailure(response)

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** What the server most recently said a newer desktop was available, if anything. */
export function upgradeAdvisory(response: Response): string | null {
  return response.headers.get(UPGRADE_HEADER)
}

async function describeFailure(response: Response): Promise<ServerError> {
  let code: string | null = null
  let message: string | null = null
  let upgradeTo: string | null = null

  try {
    const body = (await response.json()) as {
      error?: string
      message?: string
      recommendedDesktop?: string
    }
    code = body.error ?? null
    message = body.message ?? null
    upgradeTo = body.recommendedDesktop ?? null
  } catch {
    // A server behind a reverse proxy can answer with the proxy's HTML error
    // page rather than ours. The status is still the finding.
  }

  if (response.status === 426) {
    return new ServerError(
      message ?? 'This server needs a newer version of Foxfire.',
      426,
      code,
      upgradeTo
    )
  }

  return new ServerError(message ?? `The server answered ${response.status}.`, response.status, code)
}

/**
 * Says what went wrong in terms of what the person can do about it.
 *
 * These are the failures somebody hits while typing an address into a box, and
 * "fetch failed" is not an answer to any of them.
 */
function describeNetworkFailure(err: unknown, baseUrl: string): string {
  const cause = err instanceof Error ? ((err as { cause?: { code?: string } }).cause ?? null) : null
  const code = cause?.code ?? null

  if (err instanceof Error && err.name === 'TimeoutError') {
    return `${baseUrl} did not answer in time.`
  }

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Nothing found at ${baseUrl}. Check the address.`
    case 'ECONNREFUSED':
      return `${baseUrl} refused the connection. The server may not be running.`
    case 'CERT_HAS_EXPIRED':
      return `${baseUrl} has an expired certificate.`
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return (
        `${baseUrl} is using a certificate this machine does not trust. A self-hosted server ` +
        'needs a real certificate — Caddy or nginx with Let’s Encrypt will get one free.'
      )
    default:
      return `Could not reach ${baseUrl}.`
  }
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
export async function probeServer(url: string): Promise<ServerProbe> {
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
    const version = await serverRequest<{
      serverName: string
      serverVersion: string
      apiVersion: number
      minimumDesktop: string
      recommendedDesktop: string
      publicSignup: boolean
    }>(url, '/version')

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
      compatibility: judge(version.minimumDesktop, version.recommendedDesktop)
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
function judge(minimum: string, recommended: string): ServerProbe['compatibility'] {
  const mine = parseVersion(app.getVersion())
  const min = parseVersion(minimum)
  const rec = parseVersion(recommended)
  if (!mine || !min || !rec) return 'unknown'

  if (compare(mine, min) < 0) return 'unsupported'
  if (compare(mine, rec) < 0) return 'outdated'
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
