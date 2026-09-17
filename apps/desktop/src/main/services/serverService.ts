import { getDb } from '../db'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import { clearSecret, loadSecret, saveSecret } from '../security/keyStore'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { createLogger } from '../telemetry/logger'
import { ServerError, probeServer, serverRequest } from '../server/client'
import { displayName, inviteTokenFrom, normaliseServerUrl } from '../server/url'
import type {
  InvitePreview,
  KnownServer,
  ServerAuthResult,
  ServerCredentials,
  ServerProbe,
  ServerRegistration,
  ServerSession,
  ServerState
} from '@shared/types'

const log = createLogger('server')

const ACTIVE_SETTING = 'server.active'
const KNOWN_SETTING = 'server.known'

/**
 * How early to renew an access token.
 *
 * The token lives fifteen minutes and the server allows thirty seconds of clock
 * skew, so renewing a minute out means a request is never sent with one that
 * expires in flight — which would be a spurious sign-in prompt in the middle of
 * somebody's evening.
 */
const RENEW_BEFORE_MS = 60_000

/** What a server hands back after registering or signing in. */
interface SessionResponse {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
  user: { id: string; username: string; email: string; isAdmin: boolean }
}

/** One remembered server, as stored. */
interface StoredServer {
  url: string
  name: string
  username: string | null
}

/**
 * The desktop's half of talking to a Foxfire server.
 *
 * Holds three things and keeps them straight. Which servers this install knows
 * about, which one is answering, and the credentials for it.
 *
 * Only the refresh token is ever written down, and it goes to the same
 * encrypted store as the Riot API key and the OBS password rather than to
 * app_settings — `stats.db` is a file somebody might reasonably copy or attach
 * to a bug report, and it should not carry a credential when they do. The
 * access token lives in memory for its fifteen minutes and is never persisted
 * at all: it cannot be revoked, so the less time it exists the better.
 *
 * All of this stays in the main process. The renderer is sandboxed, has no
 * network access and a `default-src 'self'` policy, and there is no reason to
 * give it a bearer token to leak — it goes on calling `window.api` and does not
 * learn where the answers come from.
 */

/** Access tokens, in memory only, by server URL. */
const accessTokens = new Map<string, { token: string; expiresAt: number }>()

/**
 * Set when the active server refuses this build.
 *
 * Latched rather than thrown away, for the same reason the Riot key rejection
 * is: it happens on some request nobody was watching, and the window has to be
 * able to ask later. Holds the version to install, which — with no auto-update
 * yet — is the entire remedy.
 */
let upgradeRequired: string | null = null

function secretName(url: string): string {
  return `server-${url}`
}

function readKnown(): StoredServer[] {
  const raw = getSetting(getDb(), KNOWN_SETTING)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as StoredServer[]
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s?.url === 'string') : []
  } catch {
    // A hand-edited or truncated row should cost the list, not the app.
    log.warn('The remembered server list could not be read; starting empty')
    return []
  }
}

function writeKnown(servers: StoredServer[]): void {
  setSetting(getDb(), KNOWN_SETTING, JSON.stringify(servers))
}

function readActive(): string | null {
  const raw = getSetting(getDb(), ACTIVE_SETTING)
  return raw ? raw : null
}

function writeActive(url: string | null): void {
  setSetting(getDb(), ACTIVE_SETTING, url ?? '')
}

/** Whether a server is currently signed in, without asking it. */
function hasCredentials(url: string): boolean {
  return loadSecret(secretName(url)) !== null
}

export function getServerState(): ServerState {
  const active = readActive()
  const known = readKnown()

  const servers: KnownServer[] = known.map((s) => ({
    url: s.url,
    name: s.name || displayName(s.url),
    username: hasCredentials(s.url) ? s.username : null,
    isActive: s.url === active
  }))

  const activeServer = active ? known.find((s) => s.url === active) : undefined
  const session: ServerSession | null =
    activeServer && hasCredentials(activeServer.url) && activeServer.username
      ? {
          url: activeServer.url,
          username: activeServer.username,
          email: '',
          isAdmin: false
        }
      : null

  return {
    activeUrl: active,
    servers,
    session,
    upgradeRequired: active ? upgradeRequired : null
  }
}

function announce(): ServerState {
  const state = getServerState()
  broadcast(CH.server.changed, state)
  return state
}

/** Asks a server what it is. Never throws; every failure is part of the answer. */
export async function probe(rawUrl: string): Promise<ServerProbe> {
  const normalised = normaliseServerUrl(rawUrl)

  if ('error' in normalised) {
    return {
      url: rawUrl,
      reachable: false,
      error: normalised.error,
      serverName: null,
      serverVersion: null,
      apiVersion: null,
      minimumDesktop: null,
      recommendedDesktop: null,
      publicSignup: null,
      compatibility: 'unknown'
    }
  }

  return probeServer(normalised.url)
}

/** What a server will say about an invite code, before anybody has an account. */
export async function previewInvite(rawUrl: string, pasted: string): Promise<InvitePreview> {
  const normalised = normaliseServerUrl(rawUrl)
  const unusable = (message: string): InvitePreview => ({
    usable: false,
    serverName: '',
    email: null,
    message
  })

  if ('error' in normalised) return unusable(normalised.error)

  const token = inviteTokenFrom(pasted)
  if (!token) return unusable('Paste the invite code, or the whole link you were sent.')

  try {
    return await serverRequest<InvitePreview>(
      normalised.url,
      `/invites/${encodeURIComponent(token)}/preview`
    )
  } catch (err) {
    return unusable(err instanceof Error ? err.message : String(err))
  }
}

export async function register(
  rawUrl: string,
  registration: ServerRegistration
): Promise<ServerAuthResult> {
  return authenticate(rawUrl, '/auth/register', {
    username: registration.username,
    email: registration.email,
    password: registration.password,
    inviteToken: registration.inviteToken ? inviteTokenFrom(registration.inviteToken) : undefined,
    deviceLabel: deviceLabel()
  })
}

export async function login(
  rawUrl: string,
  credentials: ServerCredentials
): Promise<ServerAuthResult> {
  return authenticate(rawUrl, '/auth/login', {
    email: credentials.email,
    password: credentials.password,
    deviceLabel: deviceLabel()
  })
}

/**
 * The shared half of registering and signing in.
 *
 * Both end the same way — a session from the server, a refresh token written to
 * the encrypted store, the server remembered and made active — so only the
 * request differs. Succeeding at either is what joins a server; there is no
 * separate "add server" step to get out of sync with whether you can actually
 * use it.
 */
async function authenticate(
  rawUrl: string,
  path: string,
  body: unknown
): Promise<ServerAuthResult> {
  const normalised = normaliseServerUrl(rawUrl)
  if ('error' in normalised) {
    return { ok: false, error: normalised.error, state: getServerState() }
  }

  const url = normalised.url

  try {
    const session = await serverRequest<SessionResponse>(url, path, { method: 'POST', body })

    saveSecret(secretName(url), session.refreshToken)
    accessTokens.set(url, {
      token: session.accessToken,
      expiresAt: Date.parse(session.accessTokenExpiresAt)
    })

    // The name is worth a round trip only here: it is what the server calls
    // itself, and it is what the sidebar shows from now on.
    const probed = await probeServer(url)

    const known = readKnown().filter((s) => s.url !== url)
    known.push({
      url,
      name: probed.serverName ?? displayName(url),
      username: session.user.username
    })

    writeKnown(known)
    writeActive(url)
    upgradeRequired = null

    log.info('Signed in to a Foxfire server', { url, username: session.user.username })
    return { ok: true, error: null, state: announce() }
  } catch (err) {
    if (err instanceof ServerError && err.isUnsupportedClient) {
      upgradeRequired = err.upgradeTo
    }

    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      state: getServerState()
    }
  }
}

/**
 * Signs out of the active server, and tells it so.
 *
 * The local credential goes whatever the server says. A logout that fails
 * because the homelab is down must still log you out of the app in front of
 * you; the refresh token expires on its own soon enough.
 */
export async function logout(): Promise<ServerState> {
  const url = readActive()
  if (!url) return getServerState()

  const refreshToken = loadSecret(secretName(url))

  if (refreshToken) {
    try {
      await serverRequest(url, '/auth/logout', { method: 'POST', body: { refreshToken } })
    } catch (err) {
      log.debug('The server could not be told about a sign-out', { error: String(err) })
    }
  }

  clearSecret(secretName(url))
  accessTokens.delete(url)

  writeKnown(readKnown().map((s) => (s.url === url ? { ...s, username: null } : s)))
  writeActive(null)
  upgradeRequired = null

  return announce()
}

/**
 * Chooses which server answers, or none at all.
 *
 * Null is local-only mode, and switching to it is not the same as signing out:
 * the credential stays, so coming back does not mean typing a password again.
 */
export function setActiveServer(url: string | null): ServerState {
  if (url === null) {
    writeActive(null)
    upgradeRequired = null
    return announce()
  }

  const known = readKnown()
  if (!known.some((s) => s.url === url)) {
    log.warn('Asked to activate a server this install does not know', { url })
    return getServerState()
  }

  writeActive(url)
  upgradeRequired = null
  return announce()
}

/** Forgets a server and the credential for it. */
export function forgetServer(url: string): ServerState {
  clearSecret(secretName(url))
  accessTokens.delete(url)
  writeKnown(readKnown().filter((s) => s.url !== url))
  if (readActive() === url) writeActive(null)
  return announce()
}

/**
 * A request to the active server, with a live access token on it.
 *
 * This is what the HTTP half of the data layer will call once matches move
 * server-side — it is the reason the token handling is a service rather than
 * something the settings page does for itself.
 *
 * Renewal happens before the request rather than in response to a 401, so an
 * expiry does not cost a round trip. The 401 path is still there, because a
 * token can also stop meaning something for reasons no clock predicts: an admin
 * revoking a session, or a server that lost its signing key.
 */
export async function authedRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const url = readActive()
  if (!url) throw new ServerError('Not connected to a Foxfire server.', 0)

  try {
    return await withToken<T>(url, path, options, await accessTokenFor(url))
  } catch (err) {
    if (!(err instanceof ServerError) || !err.isUnauthorized) throw err

    // Refused despite a token that looked live. Force one renewal and try once.
    accessTokens.delete(url)
    return withToken<T>(url, path, options, await accessTokenFor(url))
  }
}

async function withToken<T>(
  url: string,
  path: string,
  options: { method?: string; body?: unknown },
  accessToken: string
): Promise<T> {
  try {
    return await serverRequest<T>(url, path, { ...options, accessToken })
  } catch (err) {
    if (err instanceof ServerError && err.isUnsupportedClient) {
      upgradeRequired = err.upgradeTo
      announce()
    }
    throw err
  }
}

/** A live access token for a server, renewing it from the refresh token if needed. */
async function accessTokenFor(url: string): Promise<string> {
  const held = accessTokens.get(url)
  if (held && held.expiresAt - Date.now() > RENEW_BEFORE_MS) return held.token

  const refreshToken = loadSecret(secretName(url))
  if (!refreshToken) throw new ServerError('Not signed in to this server.', 401)

  let session: SessionResponse
  try {
    session = await serverRequest<SessionResponse>(url, '/auth/refresh', {
      method: 'POST',
      body: { refreshToken }
    })
  } catch (err) {
    if (err instanceof ServerError && err.isUnauthorized) {
      // The session is over for good — expired, revoked, or the chain was cut
      // because a spent token was replayed. Drop the credential so the UI shows
      // a sign-in rather than retrying something that cannot work.
      clearSecret(secretName(url))
      accessTokens.delete(url)
      writeKnown(readKnown().map((s) => (s.url === url ? { ...s, username: null } : s)))
      announce()
    }
    throw err
  }

  // Rotating: the server just invalidated the one that was used, so the
  // replacement has to be written before anything else can go wrong.
  saveSecret(secretName(url), session.refreshToken)
  accessTokens.set(url, {
    token: session.accessToken,
    expiresAt: Date.parse(session.accessTokenExpiresAt)
  })

  return session.accessToken
}

/** Which machine this session belongs to, for the server's own session list. */
function deviceLabel(): string {
  try {
    return process.env.COMPUTERNAME || process.env.HOSTNAME || 'A Foxfire install'
  } catch {
    return 'A Foxfire install'
  }
}
