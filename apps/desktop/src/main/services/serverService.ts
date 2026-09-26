import { app } from 'electron'
import type { SessionUser } from '@foxfire/core'
import {
  ServerError,
  createServerApi,
  createServerSession,
  createTransport,
  displayName,
  tokenFromLink,
  judge,
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
  EmailChange,
  InvitePreview,
  KnownServer,
  PasswordChange,
  ServerAuthResult,
  ServerCredentials,
  ServerProbe,
  ServerRegistration,
  ServerSession as ServerSessionState,
  ServerState
} from '@shared/types'

const log = createLogger('server')

/** Who a sign-in or an account change says you are, as far as this install keeps it. */
type SignedInUser = Pick<SessionUser, 'username' | 'email' | 'isAdmin' | 'isHeadAdmin'>

const ACTIVE_SETTING = 'server.active'
const KNOWN_SETTING = 'server.known'

/**
 * Where a server's API sits beneath its address.
 *
 * Under `/api` since Foxfire Server 0.2.0, which moved it there to share its
 * address with the web client it hosts. Every route below is written relative
 * to this, the hub included; `/version` and `/health` answer at the root for
 * every build that will ever ask, and are asked for there.
 *
 * A server older than that has no `/api`, and does not know this build either:
 * it refuses it, and serverOutdated below is how that is told apart from this
 * copy being the one that is behind.
 */
const API_BASE = '/api'

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
   * Optional because a server remembered by an older build has none of them.
   */
  email?: string
  isAdmin?: boolean
  isHeadAdmin?: boolean

  /**
   * Where the server's web client is reached from outside — what "Copy link"
   * is built on, never the address this install connected with, which may be a
   * name only this network can resolve.
   *
   * Read from the server's handshake on signing in and whenever its push
   * channel connects. Absent from a server older than the web client, and from
   * a row an older build wrote; either way there is nothing to link into, and
   * "Copy link" stays hidden.
   */
  publicUrl?: string | null
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
 * able to ask later. Holds the version to install, which the updater reads as
 * the version to fetch — see updater/target.ts.
 */
let upgradeRequired: string | null = null

/**
 * Set when the active server refused this build because it is older than it.
 *
 * The other half of a refusal. A server names the newest Foxfire it knows, and
 * when that is older than this copy the fault is the server's: the remedy is
 * its host updating it, and passing its answer on as "install Foxfire 0.12.0"
 * would send somebody on 0.13.0 backwards.
 */
let serverOutdated = false

/**
 * Records a refusal, as whichever of the two it is.
 *
 * The server's 426 names the version it would serve. Judged against this
 * build's own: newer than that means the server is behind; otherwise this copy
 * is, and that version is the one to install.
 */
function recordRefusal(upgradeTo: string | null): void {
  if (upgradeTo !== null && judge(app.getVersion(), upgradeTo, upgradeTo) === 'server-outdated') {
    serverOutdated = true
    upgradeRequired = null
  } else {
    serverOutdated = false
    upgradeRequired = upgradeTo
  }
}

/** Forgets a refusal — on signing in, switching servers, signing out. */
function clearRefusal(): void {
  upgradeRequired = null
  serverOutdated = false
}

function secretName(url: string): string {
  return `server-${url}`
}

/**
 * What this build tells every server it is. The server's allow list judges it.
 *
 * Exported because the updater asks the active server the same question this
 * does — what it accepts — and a second spelling of who is asking is a second
 * thing to keep in step.
 */
export function clientIdentity(): ClientIdentity {
  return { kind: 'desktop', version: app.getVersion() }
}

function sessionFor(url: string): ServerSession {
  const existing = sessions.get(url)
  if (existing) return existing

  const session = createServerSession({
    baseUrl: url,
    basePath: API_BASE,
    identity: clientIdentity(),
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
      const isHeadAdmin = user.isHeadAdmin ?? false
      if (
        stored &&
        (stored.isAdmin !== user.isAdmin ||
          (stored.isHeadAdmin ?? false) !== isHeadAdmin ||
          stored.email !== user.email)
      ) {
        writeKnown(
          readKnown().map((s) =>
            s.url === url ? { ...s, email: user.email, isAdmin: user.isAdmin, isHeadAdmin } : s
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
      recordRefusal(upgradeTo)
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
          isAdmin: activeServer.isAdmin ?? false,
          isHeadAdmin: activeServer.isHeadAdmin ?? false
        }
      : null

  return {
    activeUrl: active,
    servers,
    session,
    publicUrl: activeServer?.publicUrl ?? null,
    upgradeRequired: active ? upgradeRequired : null,
    serverOutdated: active ? serverOutdated : false,
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

/**
 * Reads the active server's handshake again and keeps what it says.
 *
 * Its name and its public address can both change under a host's hands — a
 * rename, a move to a new domain — and a server remembered by an older build
 * never said where its web client is at all. Announced only when something
 * moved, since this runs every time the push channel connects.
 *
 * Never throws: a server that cannot be reached keeps what it last said.
 */
export async function refreshServerInfo(): Promise<void> {
  const url = readActive()
  if (!url) return

  const probed = await probeServer(url, clientIdentity())
  if (!probed.reachable) return

  const stored = readKnown().find((s) => s.url === url)
  if (!stored) return

  const name = probed.serverName ?? stored.name
  if (stored.publicUrl === probed.publicUrl && stored.name === name) return

  writeKnown(readKnown().map((s) => (s.url === url ? { ...s, name, publicUrl: probed.publicUrl } : s)))
  announce()
}

/**
 * Picks the active server back up when Foxfire starts.
 *
 * Signed in before the app was closed means signed in now — the refresh token
 * is in the encrypted store — but nothing had opened the push channel again:
 * it followed announcements, and nothing announces at launch. So a copy
 * started in server mode drew the server's data and never heard it change
 * until somebody signed in or switched servers.
 */
export function resumeActiveServer(): void {
  syncHubConnection(getServerState())
}

function announce(): ServerState {
  const state = getServerState()
  broadcast(CH.server.changed, state)
  for (const listener of stateListeners) listener(state)
  syncHubConnection(state)
  return state
}

type StateListener = (state: ServerState) => void
const stateListeners = new Set<StateListener>()

/**
 * The same announcement the windows get, for the main process.
 *
 * The updater needs it: which server is answering decides which build may be
 * installed, and a refusal names the version to install straight away rather
 * than at the next scheduled check. Pushed from here rather than pulled from
 * there, because importing the updater into this file would make a cycle out of
 * two modules that otherwise only need to know about each other in one
 * direction — the same shape appIcon.ts uses for the tray.
 */
export function onServerState(listener: StateListener): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
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

  void connectHub(url, API_BASE, clientIdentity(), () => sessionFor(url).accessToken())

  // The announcement only reaches desktops that were listening when it
  // happened. One connecting to a server that has been degraded since last
  // night would otherwise see nothing at all.
  void refreshServerHealth()
  void refreshServerInfo()
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
      publicUrl: null,
      compatibility: 'unknown'
    }
  }

  return probeServer(normalised.url, clientIdentity())
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

  const token = tokenFromLink(pasted)
  if (!token) return unusable('Paste the invite code, or the whole link you were sent.')

  try {
    // A server this install may never have joined, so no session: an invite is
    // readable by anybody who has the code, which is the point of it.
    return await createTransport({ baseUrl: normalised.url, identity: clientIdentity() }).request<InvitePreview>(
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
  signIn: (session: ServerSession) => Promise<SignedInUser>
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
    const probed = await probeServer(url, clientIdentity())

    const known = readKnown().filter((s) => s.url !== url)
    known.push({
      url,
      name: probed.serverName ?? displayName(url),
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      isHeadAdmin: user.isHeadAdmin ?? false,
      publicUrl: probed.publicUrl
    })

    writeKnown(known)
    writeActive(url)
    clearRefusal()

    log.info('Signed in to a Foxfire server', { url, username: user.username })
    return { ok: true, error: null, state: announce() }
  } catch (err) {
    if (err instanceof ServerError && err.isUnsupportedClient) {
      recordRefusal(err.upgradeTo)
    }

    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      state: getServerState()
    }
  }
}

/**
 * A change to the account on the active server, and the tidying it needs.
 *
 * The session does the work and re-reads who you are as part of it — a password
 * change comes back with a whole new pair, which it adopts and writes to the
 * key store. What is left here is the copy this install keeps for its sidebar
 * and its connect page: the name and address it shows when the server is not
 * being asked.
 */
async function changeAccount(
  apply: (session: ServerSession) => Promise<SignedInUser>
): Promise<ServerAuthResult> {
  const url = readActive()
  if (!url) {
    return { ok: false, error: 'Not connected to a Foxfire server.', state: getServerState() }
  }

  try {
    const user = await apply(sessionFor(url))

    writeKnown(
      readKnown().map((s) =>
        s.url === url
          ? {
              ...s,
              username: user.username,
              email: user.email,
              isAdmin: user.isAdmin,
              isHeadAdmin: user.isHeadAdmin ?? false
            }
          : s
      )
    )

    log.info('Changed the account on a Foxfire server', { url, username: user.username })
    return { ok: true, error: null, state: announce() }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      state: getServerState()
    }
  }
}

/** Changes the password, which signs every other device out and keeps this one. */
export function changePassword(change: PasswordChange): Promise<ServerAuthResult> {
  return changeAccount((session) => session.changePassword(change))
}

export function changeEmail(change: EmailChange): Promise<ServerAuthResult> {
  return changeAccount((session) => session.changeEmail(change))
}

export function changeUsername(username: string): Promise<ServerAuthResult> {
  return changeAccount((session) => session.changeUsername(username))
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
  clearRefusal()

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
    clearRefusal()
    return announce()
  }

  const known = readKnown()
  if (!known.some((s) => s.url === url)) {
    log.warn('Asked to activate a server this install does not know', { url })
    return getServerState()
  }

  writeActive(url)
  clearRefusal()
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
