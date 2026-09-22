import type { ConnectionState, FoxfireClient, InvitePreview, SessionUser, VersionInfo } from '@foxfire/core'
import { paths, rankQueueParam } from '@foxfire/core/routes'
import type { Platform } from '@foxfire/screens'
import { createFixtureClient, runFixtureImport } from '@foxfire/screens/dev'
import { replaceServerInfoSource } from '../serverInfo'
import { useAuth } from '../session/session'

/*
 * The design harness — `npm run dev:mock -w @foxfire/web`.
 *
 * The same fixture client the desktop's browser harness renders, so the two
 * review the same games, presented as a server this page is signed in to:
 * connected, with a public address to build links on, and an administrator at
 * the keyboard so the admin pages are reachable. ?scenario= switches the data
 * as it does on the desktop's.
 *
 * Signing out works, and lands on the sign-in page to look at; signing back in
 * does not, because there is no server to ask.
 */

const SERVER_NAME = 'The Fox Den'

const USER: SessionUser = { id: 'u-faker', username: 'Faker', email: 'faker@example.com', isAdmin: true }

const VERSION: VersionInfo = {
  serverName: SERVER_NAME,
  serverVersion: '0.2.0',
  apiVersion: 1,
  minimumDesktop: '0.12.0',
  recommendedDesktop: '0.12.0',
  publicSignup: true,
  apiBase: '/api',
  publicUrl: window.location.origin
}

export function startMock(navigate: (path: string) => void): { client: FoxfireClient; platform: Platform } {
  const fixture = createFixtureClient()
  const listeners = new Set<(state: ConnectionState) => void>()

  const connection = (): ConnectionState => {
    const user = useAuth.getState().user
    return {
      mode: 'server',
      publicUrl: window.location.origin,
      serverName: SERVER_NAME,
      session: user ? { username: user.username, email: user.email, isAdmin: user.isAdmin } : null,
      riotKeyRejected: false,
      upgradeRequired: null
    }
  }

  useAuth.subscribe(() => listeners.forEach((listener) => listener(connection())))

  const client: FoxfireClient = {
    ...fixture,
    connection: {
      get: async () => connection(),
      onChanged: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
  }

  replaceServerInfoSource({
    version: async () => VERSION,
    previewInvite: async (token): Promise<InvitePreview> =>
      token.length < 20
        ? { usable: false, serverName: SERVER_NAME, email: null, message: 'This invite link is not valid for this server.' }
        : { usable: true, serverName: SERVER_NAME, email: 'invitee@example.com', message: 'Ready to use.' }
  })

  useAuth.setState({ user: USER, ready: true })

  const platform: Platform = {
    kind: 'web',
    copyText: (text) => navigator.clipboard.writeText(text),
    openLpEditor: ({ account, queueType, matchId }) =>
      navigate(paths.lpEditor(account, { queue: rankQueueParam(queueType), match: matchId })),
    downloadReplay: async () => ({ ok: false, message: 'The harness has no blob store to download from.' }),
    statsDbImport: {
      pick: async () => ({ source: null, label: 'stats.db' }),
      run: (_source, onProgress) => runFixtureImport(onProgress)
    }
  }

  return { client, platform }
}
