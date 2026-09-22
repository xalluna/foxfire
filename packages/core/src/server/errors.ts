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

/**
 * The server's own account of a refusal, where it gave one.
 *
 * Errors are the server's shape (`{ error, message }`) wherever it sent one, so
 * the message shown is the one the server wrote rather than a status code
 * translated twice.
 */
export async function describeFailure(response: Response): Promise<ServerError> {
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
 * "fetch failed" is not an answer to any of them. The codes are the ones Node
 * attaches as the error's cause; a browser attaches none and says no more than
 * that the request failed, so there this falls through to the plain sentence.
 */
export function describeNetworkFailure(err: unknown, baseUrl: string): string {
  const where = baseUrl || 'The server'
  const cause = err instanceof Error ? ((err as { cause?: { code?: string } }).cause ?? null) : null
  const code = cause?.code ?? null

  if (err instanceof Error && err.name === 'TimeoutError') {
    return `${where} did not answer in time.`
  }

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Nothing found at ${where}. Check the address.`
    case 'ECONNREFUSED':
      return `${where} refused the connection. The server may not be running.`
    case 'CERT_HAS_EXPIRED':
      return `${where} has an expired certificate.`
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return (
        `${where} is using a certificate this machine does not trust. A self-hosted server ` +
        'needs a real certificate — Caddy or nginx with Let’s Encrypt will get one free.'
      )
    default:
      return baseUrl ? `Could not reach ${baseUrl}.` : 'Could not reach the server.'
  }
}
