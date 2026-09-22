import { ServerError, describeFailure, describeNetworkFailure } from './errors'
import { identityHeaders, type ClientIdentity } from './identity'

/**
 * Long enough for a homelab on a domestic connection, short enough that a
 * server which has gone away does not leave a spinner running for a minute.
 */
export const DEFAULT_TIMEOUT_MS = 15_000

export interface RequestOptions {
  method?: string
  body?: unknown
  /** Sent as a bearer token when present. */
  accessToken?: string | null
  signal?: AbortSignal
}

export interface TransportOptions {
  /**
   * The server's origin with no trailing slash, or '' for the origin the page
   * itself was served from — which is the web client's case, and the reason
   * it needs no address configured at all.
   */
  baseUrl: string
  identity: ClientIdentity
  timeoutMs?: number
  /** For tests. Defaults to the global fetch, which Node and browsers both have. */
  fetch?: typeof fetch
}

/** Calls to one Foxfire server, each carrying who the caller is. */
export interface Transport {
  readonly baseUrl: string
  readonly identity: ClientIdentity
  request<T>(path: string, options?: RequestOptions): Promise<T>
}

/**
 * One server's worth of requests.
 *
 * Every request carries the client's identity, including the unauthenticated
 * ones, because the server decides what it will talk to before it decides who
 * is talking. A 426 comes back as a ServerError that names the version to
 * install — with no auto-update on the desktop, that string is the whole of
 * what a stranded user has to go on.
 */
export function createTransport(options: TransportOptions): Transport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))

  return {
    baseUrl: options.baseUrl,
    identity: options.identity,

    async request<T>(path: string, request: RequestOptions = {}): Promise<T> {
      const headers: Record<string, string> = {
        ...identityHeaders(options.identity),
        Accept: 'application/json'
      }

      if (request.body !== undefined) headers['Content-Type'] = 'application/json'
      if (request.accessToken) headers.Authorization = `Bearer ${request.accessToken}`

      let response: Response
      try {
        response = await fetchImpl(`${options.baseUrl}${path}`, {
          method: request.method ?? 'GET',
          headers,
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
          signal: request.signal ?? AbortSignal.timeout(timeoutMs)
        })
      } catch (err) {
        // No answer at all: wrong address, server down, DNS, a certificate the
        // system does not trust. Status 0 marks it as never having reached one.
        throw new ServerError(describeNetworkFailure(err, options.baseUrl), 0)
      }

      if (!response.ok) throw await describeFailure(response)

      if (response.status === 204) return undefined as T

      // A body-less 200 or 202 — a sync that was started, say — is not a
      // failure to parse, it is an answer with nothing in it.
      const text = await response.text()
      return (text ? JSON.parse(text) : undefined) as T
    }
  }
}
