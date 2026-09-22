import { create } from 'zustand'
import type { ServerCredentials, ServerRegistration, SessionUser } from '@foxfire/core'
import { WEB_API_VERSION, createServerSession, type ServerSession } from '@foxfire/core/server'
import { refreshLock } from './locks'

/** What the web client says it is on every request: `web`, built against this API version. */
export const WEB_IDENTITY = { kind: 'web', apiVersion: WEB_API_VERSION } as const

interface AuthState {
  /** Who is signed in, or null. */
  user: SessionUser | null
  /** Whether the first restore has answered. Until it has, nobody is signed in or out. */
  ready: boolean
  /** The server no longer serves the API this page was built against. */
  upgradeRequired: boolean
}

/** Who is signed in, as every part of the page reads it. */
export const useAuth = create<AuthState>(() => ({ user: null, ready: false, upgradeRequired: false }))

type SessionMessage = 'signed-in' | 'signed-out'

/**
 * Tells the other tabs of this site when somebody signs in or out here.
 *
 * They share the cookie, so the session is already theirs — what they lack is
 * the news. A tab left on the sign-in page moves on when another signs in, and
 * every tab lets go when one signs out, rather than carrying on until its
 * access token lapses and then discovering it.
 */
const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('foxfire:session')

function tellOtherTabs(message: SessionMessage): void {
  channel?.postMessage(message)
}

/**
 * The one session this page has, with the server that served it.
 *
 * Same origin, so the base URL is the page's own, and the refresh token is a
 * cookie the page never sees — see SessionTransport on the server.
 */
export const session: ServerSession = createServerSession({
  baseUrl: '',
  basePath: '/api',
  identity: WEB_IDENTITY,
  tokenTransport: 'cookie',
  refreshLock: refreshLock('foxfire:refresh'),
  deviceLabel: describeBrowser(),
  onUserRefreshed: (user) => useAuth.setState({ user }),
  onSignedOut: () => useAuth.setState({ user: null }),
  onUpgradeRequired: () => useAuth.setState({ upgradeRequired: true })
})

/**
 * Picks up the session this browser already has, if any.
 *
 * A refresh with whatever cookie is there: no cookie, or one the server has
 * ended, is simply nobody signed in.
 */
export async function restore(): Promise<SessionUser | null> {
  try {
    const user = await session.restore()
    useAuth.setState({ user, ready: true })
    return user
  } catch (err) {
    // The server being unreachable is not the same as being signed out, but
    // there is nothing to show either way; the sign-in page says it cannot
    // reach the server when somebody tries.
    useAuth.setState({ user: null, ready: true })
    throw err
  }
}

export async function signIn(credentials: ServerCredentials): Promise<SessionUser> {
  const user = await session.login(credentials)
  useAuth.setState({ user })
  tellOtherTabs('signed-in')
  return user
}

export async function register(registration: ServerRegistration): Promise<SessionUser> {
  const user = await session.register(registration)
  useAuth.setState({ user })
  tellOtherTabs('signed-in')
  return user
}

export async function signOut(): Promise<void> {
  await session.logout()
  useAuth.setState({ user: null })
  tellOtherTabs('signed-out')
}

if (channel) {
  channel.onmessage = (event: MessageEvent<SessionMessage>) => {
    if (event.data === 'signed-in') {
      // Refreshes under the shared lock, so this tab takes its turn with the
      // cookie the other one was just given.
      void session.restore().then(
        (user) => useAuth.setState({ user }),
        () => undefined
      )
    } else if (event.data === 'signed-out') {
      session.reset()
      useAuth.setState({ user: null })
    }
  }
}

/** What the server's list of sessions calls this one — "Firefox on Windows". */
function describeBrowser(): string {
  const agent = globalThis.navigator?.userAgent ?? ''
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'A browser'
  const os = /Windows/.test(agent)
    ? 'Windows'
    : /Mac OS X/.test(agent)
      ? 'macOS'
      : /Android/.test(agent)
        ? 'Android'
        : /iPhone|iPad/.test(agent)
          ? 'iOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : null
  return os ? `${browser} on ${os}` : browser
}
