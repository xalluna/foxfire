import type { ServerCredentials, ServerRegistration, SessionUser } from '../types'
import { silentLogger, type Logger } from '../log'
import { ServerError } from './errors'
import type { ClientIdentity } from './identity'
import { createTransport, type Transport } from './transport'
import { inviteTokenFrom } from './url'

/**
 * How early to renew an access token.
 *
 * The token lives fifteen minutes and the server allows thirty seconds of clock
 * skew, so renewing a minute out means a request is never sent with one that
 * expires in flight — which would be a spurious sign-in prompt in the middle of
 * somebody's evening.
 */
export const RENEW_BEFORE_MS = 60_000

/**
 * Where a refresh token is kept between runs.
 *
 * The desktop's is encrypted with the OS credential store and written outside
 * the database file. A browser keeps nothing: its refresh token is a cookie
 * the page cannot read, which is the whole point of it being one.
 */
export interface SessionStore {
  load(): string | null | Promise<string | null>
  save(refreshToken: string): void | Promise<void>
  clear(): void | Promise<void>
}

/**
 * Makes renewals take turns across everything sharing one refresh token.
 *
 * Within one session that is already true; see `accessToken`. What this covers
 * is several sessions sharing a token — browser tabs, which share the cookie —
 * where two renewals at once would spend the same token twice.
 */
export interface RefreshLock {
  run<T>(renew: () => Promise<T>): Promise<T>
}

export interface ServerSessionOptions {
  /** The server's origin with no trailing slash, or '' for the page's own origin. */
  baseUrl: string
  /** Where the API is mounted beneath it, e.g. '/api'. Every path given to `request` is under it. */
  basePath?: string
  identity: ClientIdentity
  /**
   * How the refresh token travels.
   *
   * 'body' is the desktop's: the server returns the token and the client keeps
   * it, in `store`. 'cookie' is the browser's: the server sets it httpOnly on
   * the auth path and the client never sees it, so an injected script has no
   * month-long credential to steal.
   */
  tokenTransport: 'body' | 'cookie'
  /** Required for 'body'. */
  store?: SessionStore
  refreshLock?: RefreshLock
  /** What the server's session list calls this machine. */
  deviceLabel?: string
  timeoutMs?: number
  renewBeforeMs?: number
  fetch?: typeof fetch
  log?: Logger

  /**
   * After every renewal, with who the server now says you are.
   *
   * A refresh re-reads the account rather than trusting the old token's claims,
   * so this is where a change of role lands: the server revokes the sessions of
   * anybody whose role changes, and the next renewal carries the new answer.
   */
  onUserRefreshed?(user: SessionUser): void

  /** The session is over for good — expired, revoked, or cut because a spent token was replayed. */
  onSignedOut?(): void

  /** The server refused this build outright. Carries the version it wants, when it named one. */
  onUpgradeRequired?(upgradeTo: string | null): void
}

/** One signed-in presence on one server. */
export interface ServerSession {
  readonly baseUrl: string
  readonly basePath: string
  /** For the few calls that need no session: the server's health, an invite preview. */
  readonly transport: Transport
  register(registration: ServerRegistration): Promise<SessionUser>
  login(credentials: ServerCredentials): Promise<SessionUser>
  /**
   * Picks a session back up, if there is one to pick up.
   *
   * Null when there is not, which is an ordinary answer — somebody who has
   * never signed in, or whose session ended while they were away.
   */
  restore(): Promise<SessionUser | null>
  logout(): Promise<void>
  /** A live access token, renewed first if it is about to expire. */
  accessToken(): Promise<string>
  /** Who the server last said this is, or null before anything has been asked. */
  user(): SessionUser | null
  /** Forgets the access token held in memory. The stored credential is the caller's to clear. */
  reset(): void
  /** A request with a live token on it, to a path under `basePath`. */
  request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>
}

/** What a server hands back after registering, signing in or refreshing. */
interface SessionResponse {
  accessToken: string
  accessTokenExpiresAt: string
  /** Absent when the server set it as a cookie instead. */
  refreshToken?: string
  refreshTokenExpiresAt?: string
  user: SessionUser
}

/**
 * The half of talking to a Foxfire server that keeps somebody signed in.
 *
 * Renewal happens before a request rather than in response to a 401, so an
 * expiry does not cost a round trip. The 401 path is still there, because a
 * token can also stop meaning something for reasons no clock predicts: an admin
 * revoking a session, or a server that lost its signing key.
 *
 * The access token lives in memory for its fifteen minutes and is never
 * persisted: it cannot be revoked, so the less time it exists the better.
 */
export function createServerSession(options: ServerSessionOptions): ServerSession {
  const basePath = options.basePath ?? ''
  const renewBefore = options.renewBeforeMs ?? RENEW_BEFORE_MS
  const log = options.log ?? silentLogger
  const store = options.store

  if (options.tokenTransport === 'body' && !store) {
    throw new Error('A session that keeps its own refresh token needs somewhere to keep it.')
  }

  const transport = createTransport({
    baseUrl: options.baseUrl,
    identity: options.identity,
    timeoutMs: options.timeoutMs,
    fetch: options.fetch
  })

  let held: { token: string; expiresAt: number } | null = null
  let current: SessionUser | null = null
  let renewing: Promise<string> | null = null

  async function adopt(session: SessionResponse): Promise<SessionUser> {
    // Rotating: the server just invalidated the token that was used, so the
    // replacement has to be written before anything else can go wrong.
    if (store && session.refreshToken) await store.save(session.refreshToken)

    held = { token: session.accessToken, expiresAt: Date.parse(session.accessTokenExpiresAt) }
    current = session.user
    return session.user
  }

  async function signOutLocally(): Promise<void> {
    held = null
    current = null
    if (store) await store.clear()
  }

  function upgradeRequired(err: unknown): void {
    if (err instanceof ServerError && err.isUnsupportedClient) options.onUpgradeRequired?.(err.upgradeTo)
  }

  async function authenticate(path: string, body: Record<string, unknown>): Promise<SessionUser> {
    try {
      const session = await transport.request<SessionResponse>(`${basePath}${path}`, {
        method: 'POST',
        body: { ...body, deviceLabel: options.deviceLabel }
      })
      return await adopt(session)
    } catch (err) {
      upgradeRequired(err)
      throw err
    }
  }

  async function renew(): Promise<string> {
    const attempt = async (): Promise<string> => {
      let body: { refreshToken: string } | undefined

      if (store) {
        const refreshToken = await store.load()
        if (!refreshToken) throw new ServerError('Not signed in to this server.', 401)
        body = { refreshToken }
      }

      let session: SessionResponse
      try {
        session = await transport.request<SessionResponse>(`${basePath}/auth/refresh`, {
          method: 'POST',
          body
        })
      } catch (err) {
        if (err instanceof ServerError && err.isUnauthorized) {
          // Drop the credential so the UI shows a sign-in rather than retrying
          // something that cannot work.
          await signOutLocally()
          options.onSignedOut?.()
        }
        upgradeRequired(err)
        throw err
      }

      const user = await adopt(session)
      options.onUserRefreshed?.(user)
      return session.accessToken
    }

    return options.refreshLock ? options.refreshLock.run(attempt) : attempt()
  }

  async function accessToken(): Promise<string> {
    if (held && held.expiresAt - Date.now() > renewBefore) return held.token

    // One renewal at a time. Two screens asking at once as the token nears
    // expiry would otherwise both spend the same refresh token, and the second
    // spend is indistinguishable from a stolen copy being replayed — the server
    // cuts the whole chain and signs the person out everywhere.
    if (!renewing) renewing = renew().finally(() => (renewing = null))
    return renewing
  }

  async function withToken<T>(
    path: string,
    init: { method?: string; body?: unknown },
    token: string
  ): Promise<T> {
    try {
      return await transport.request<T>(`${basePath}${path}`, { ...init, accessToken: token })
    } catch (err) {
      upgradeRequired(err)
      throw err
    }
  }

  return {
    baseUrl: options.baseUrl,
    basePath,
    transport,

    register: (registration) =>
      authenticate('/auth/register', {
        username: registration.username,
        email: registration.email,
        password: registration.password,
        inviteToken: registration.inviteToken ? inviteTokenFrom(registration.inviteToken) : undefined
      }),

    login: (credentials) =>
      authenticate('/auth/login', { email: credentials.email, password: credentials.password }),

    async restore() {
      if (store && !(await store.load())) return null

      held = null
      try {
        await accessToken()
        return current
      } catch (err) {
        if (err instanceof ServerError && err.isUnauthorized) return null
        throw err
      }
    },

    async logout() {
      // The local credential goes whatever the server says. A logout that fails
      // because the homelab is down must still sign you out of the app in front
      // of you; the refresh token expires on its own soon enough.
      try {
        if (store) {
          const refreshToken = await store.load()
          if (refreshToken) {
            await transport.request(`${basePath}/auth/logout`, {
              method: 'POST',
              body: { refreshToken }
            })
          }
        } else {
          await transport.request(`${basePath}/auth/logout`, { method: 'POST' })
        }
      } catch (err) {
        log.debug('The server could not be told about a sign-out', { error: String(err) })
      } finally {
        await signOutLocally()
      }
    },

    accessToken,

    user: () => current,

    reset() {
      held = null
      current = null
    },

    async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
      // Outside the retry: a renewal the server refused has already signed this
      // session out, and asking again would only be told the same thing.
      const token = await accessToken()

      try {
        return await withToken<T>(path, init, token)
      } catch (err) {
        if (!(err instanceof ServerError) || !err.isUnauthorized) throw err

        // Refused despite a token that looked live. Force one renewal and try once.
        held = null
        return withToken<T>(path, init, await accessToken())
      }
    }
  }
}
