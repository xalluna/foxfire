import { app } from 'electron'
import {
  ServerError,
  createServerApi,
  createServerSession,
  createTransport,
  displayName,
  inviteTokenFrom,
  normaliseServerUrl,
  probeServer,
  type ClientIdentity,
  type ServerApi,
  type ServerSession
} from '@foxfire/core/server'
import { getDb } from '../db'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import { clearSecret, loadSecret, saveSecret } from '../security/keyStore'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { connectHub, disconnectHub } from '../server/hub'
import { createLogger } from '../telemetry/logger'
import type {
  InvitePreview,
  KnownServer,
  ServerAuthResult,
  ServerCredentials,
  ServerProbe,
  ServerRegistration,
  ServerSession as ServerSessionState,
  ServerState
} from '@shared/types'

const log = createLogger('server')

const ACTIVE_SETTING = 'server.active'
const KNOWN_SETTING = 'server.known'

/**
 * Where a server's API sits beneath its address.
 *
 * The root, for now, and so for every server this build has spoken to. Kept as
 * one constant because it is exactly the kind of thing that moves: every route
 * below is written relative to it, and `/version` and `/health` — which never
 * move — are asked for at the root regardless.
 */
const API_BASE = ''

/** One remembered server, as stored. */
interface StoredServer {
  url: string
  name: string
  username: string | null

  /**
   * The rest of who you are there, kept because getServerState is synchronous
   * and callers ask it constantly — isServerMode is on the path of every read.
   * Asking the server would make it async and every one of those an await.
   *
   * Refreshed from the session every time a token is renewed, which is how a
   * promotion or a demotion arrives: the server revokes the sessions of anybody
   * whose role changes, so the next renewal carries the new answer.
   *
   * Optional because a server remembered by an older build has neither.
   */
  email?: string
  isAdmin?: boolean
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
 * access token lives in memory, inside the session, for its fifteen minutes.
 * The renewing itself — and the care it takes never to spend one refresh token
 * twice — is @foxfire/core's, which the web client shares.
 *
 * All of this stays in the main process. The renderer is sandboxed, has no
 * network access and a `default-src 'self'` policy, and there is no reason to
 * give it a bearer token to leak — it goes on calling `window.api` and does not
 * learn where the answers come from.
 */

/** One session per server, created on first use and kept for the life of the process. */
const sessions = new Map<string, ServerSession>()

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

/** What this build tells every server it is. The server's allow list judges it. */
function identity(): ClientIdentity {
  return { kind: 'desktop', version: app.getVersion() }
}

function sessionFor(url: string): ServerSession {
  const existing = sessions.get(url)
  if (existing) return existing

  const session = createServerSession({
    baseUrl: url,
    basePath: API_BASE,
    identity: identity(),
    tokenTransport: 'body',
    store: {
      load: () => loadSecret(secretName(url)),
      save: (refreshToken) => saveSecret(secretName(url), refreshToken),
      clear: () => clearSecret(secretName(url))
    },
    deviceLabel: deviceLabel(),
    log,

    // A refresh re-reads the account rather than trusting the old token's
    // claims, so this is where a change of role lands. Announced only when
    // something actually moved, because this runs every fifteen minutes and a
    // state event per renewal would invalidate caches all evening for nothing.
    onUserRefreshed: (user) => {
      const stored = readKnown().find((s) => s.url === url)
      if (stored && (stored.isAdmin !== user.isAdmin || stored.email !== user.email)) {
        writeKnown(
          readKnown().map((s) =>
            s.url === url ? { ...s, email: user.email, isAdmin: user.isAdmin } : s
          )
        )
        announce()
      }
    },

    // The session is over for good. The credential is already gone; forgetting
    // the name as well is what makes the UI offer a sign-in rather than retry.
    onSignedOut: () => {
      writeKnown(readKnown().map((s) => (s.url === url ? { ...s, username: null } : s)))
      announce()
    },

    onUpgradeRequired: (upgradeTo) => {
      upgradeRequired = upgradeTo
      announce()
    }
  })

  sessions.set(url, session)
  return session
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

/**
 * Whether this install is currently reading from a server rather than from its
 * own database.
 *
 * A signed-in session and not merely a configured server. One that is known but
 * not signed in to is a row on the Settings page: every read through it would
 * fail on a missing token, while local-only mode works — which makes local-only
 * the honest answer while somebody is halfway through joining a community.
 */
export function isServerMode(): boolean {
  const { activeUrl, session } = getServerState()
  return activeUrl !== null && session !== null
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
  const session: ServerSessionState | null =
    activeServer && hasCredentials(activeServer.url) && activeServer.username
      ? {
          url: activeServer.url,
          username: activeServer.username,
          email: activeServer.email ?? '',

          // Defaulting to false is the safe direction: a stored row from before
          // this was kept shows no admin pages until the next token renewal
          // fills it in, rather than offering pages whose every call 403s.
          isAdmin: activeServer.isAdmin ?? false
        }
      : null

  return {
    activeUrl: active,
    servers,
    session,
    upgradeRequired: active ? upgradeRequired : null,
    riotKeyRejected: active ? riotKeyRejected : false
  }
}

/**
 * Whether the active server's Riot key has been refused.
 *
 * Held in memory rather than stored: it is a fact about a server right now, and
 * a restart should ask again rather than remember an answer from yesterday —
 * the host may well have fixed it overnight, which is the ordinary case for a
 * key that expires every twenty-four hours.
 */
let riotKeyRejected = false

/**
 * Records that Riot has refused the active server's key.
 *
 * Called by the hub, which hears it the moment it happens, and by the health
 * check below, which covers the desktop that connects to a server already in
 * that state and so missed the announcement.
 */
export function setServerRiotKeyRejected(rejected: boolean): void {
  if (riotKeyRejected === rejected) return
  riotKeyRejected = rejected
  announce()
}

/**
 * Asks the active server how it is, and records the answer.
 *
 * Never throws. A server that cannot be reached is not a server with a dead
 * key, and reporting one as the other would put the wrong banner in front of
 * somebody — the reads failing will say so on their own.
 */
export async function refreshServerHealth(): Promise<void> {
  const url = readActive()
  if (!url) return

  try {
    const health = await sessionFor(url).transport.request<{ riotKeyRejected: boolean }>('/health')
    setServerRiotKeyRejected(health.riotKeyRejected === true)
  } catch (err) {
    log.debug('Could not read server health', { error: String(err) })
  }
}

function announce(): ServerState {
  const state = getServerState()
  broadcast(CH.server.changed, state)
  syncHubConnection(state)
  return state
}

/**
 * Keeps the push connection pointing wherever the reads are.
 *
 * Driven from announce rather than from each caller because every way the
 * answer changes — signing in, signing out, switching servers, forgetting
 * one — already goes through it, and a connection left open to a server this
 * app is no longer reading from would deliver events about somebody else's
 * community.
 *
 * Never awaited. Everything the hub carries is a refresh of something the
 * renderer can also ask for, so a socket that will not open costs a stale
 * screen rather than a broken one.
 */
function syncHubConnection(state: ServerState): void {
  const url = state.activeUrl

  if (!url || !state.session) {
    void disconnectHub()
    return
  }

  void connectHub(url, API_BASE, identity(), () => sessionFor(url).accessToken())

  // The announcement only reaches desktops that were listening when it
  // happened. One connecting to a server that has been degraded since last
  // night would otherwise see nothing at all.
  void refreshServerHealth()
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

  return probeServer(normalised.url, identity())
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
    // A server this install may never have joined, so no session: an invite is
    // readable by anybody who has the code, which is the point of it.
    return await createTransport({ baseUrl: normalised.url, identity: identity() }).request<InvitePreview>(
      `${API_BASE}/invites/${encodeURIComponent(token)}/preview`
    )
  } catch (err) {
    return unusable(err instanceof Error ? err.message : String(err))
  }
}

export async function register(
  rawUrl: string,
  registration: ServerRegistration
): Promise<ServerAuthResult> {
  return authenticate(rawUrl, (session) => session.register(registration))
}

export async function login(
  rawUrl: string,
  credentials: ServerCredentials
): Promise<ServerAuthResult> {
  return authenticate(rawUrl, (session) => session.login(credentials))
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
  signIn: (session: ServerSession) => Promise<{ username: string; email: string; isAdmin: boolean }>
): Promise<ServerAuthResult> {
  const normalised = normaliseServerUrl(rawUrl)
  if ('error' in normalised) {
    return { ok: false, error: normalised.error, state: getServerState() }
  }

  const url = normalised.url

  try {
    const user = await signIn(sessionFor(url))

    // The name is worth a round trip only here: it is what the server calls
    // itself, and it is what the sidebar shows from now on.
    const probed = await probeServer(url, identity())

    const known = readKnown().filter((s) => s.url !== url)
    known.push({
      url,
      name: probed.serverName ?? displayName(url),
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin
    })

    writeKnown(known)
    writeActive(url)
    upgradeRequired = null

    log.info('Signed in to a Foxfire server', { url, username: user.username })
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

  await sessionFor(url).logout()

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
  sessions.get(url)?.reset()
  sessions.delete(url)
  writeKnown(readKnown().filter((s) => s.url !== url))
  if (readActive() === url) writeActive(null)
  return announce()
}

/**
 * A request to the active server, with a live access token on it.
 *
 * What everything that reads from or reports to a server goes through. The
 * path is relative to the server's API base; the session supplies the token,
 * renews it when it is about to lapse, and retries once if the server refuses
 * one that looked live.
 */
export async function authedRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const url = readActive()
  if (!url) throw new ServerError('Not connected to a Foxfire server.', 0)

  return sessionFor(url).request<T>(path, options)
}

let api: ServerApi | null = null

/**
 * The routes both clients share, bound to whichever server is active.
 *
 * Built once over `authedRequest`, which looks the active server up per call,
 * so switching servers changes where the next request goes rather than needing
 * a new object.
 */
export function serverApi(): ServerApi {
  api ??= createServerApi(authedRequest, { log })
  return api
}

/** Which machine this session belongs to, for the server's own session list. */
function deviceLabel(): string {
  try {
    return process.env.COMPUTERNAME || process.env.HOSTNAME || 'A Foxfire install'
  } catch {
    return 'A Foxfire install'
  }
}
