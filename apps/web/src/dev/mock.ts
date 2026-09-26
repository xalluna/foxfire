import type {
  ConnectionState,
  FoxfireClient,
  InvitePreview,
  PasswordResetPreview,
  SessionUser,
  VersionInfo
} from '@foxfire/core'
import { paths, rankQueueParam } from '@foxfire/core/routes'
import type { Platform, RecordingTarget } from '@foxfire/screens'
import { createFakeYouTubeMount, createFixtureClient, runFixtureImport, scenario } from '@foxfire/screens/dev'
import { YOUTUBE_ENABLED } from '../features'
import { createWebYouTubeMount } from '../platform/youtubePlayer'
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
 * does not, because there is no server to ask. The same goes for a reset link:
 * /reset-password/<anything long> shows the form, and setting a password needs
 * a server.
 */

const SERVER_NAME = 'The Fox Den'

// Faker is the configured head admin; ?scenario=server-admin signs in as Sova,
// a plain one, to see the pages the way they do.
const USER: SessionUser =
  scenario === 'server-admin'
    ? { id: 'u-sova', username: 'Sova', email: 'sova@example.com', isAdmin: true, isHeadAdmin: false }
    : { id: 'u-faker', username: 'Faker', email: 'faker@example.com', isAdmin: true, isHeadAdmin: true }

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
      session: user
        ? { username: user.username, email: user.email, isAdmin: user.isAdmin, isHeadAdmin: user.isHeadAdmin ?? false }
        : null,
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
        : { usable: true, serverName: SERVER_NAME, email: 'invitee@example.com', message: 'Ready to use.' },

    // A short token is the unusable state, the same way the invite preview
    // treats one. Setting the password itself needs a server, so the harness
    // shows the two states of the page rather than the whole errand.
    previewPasswordReset: async (token): Promise<PasswordResetPreview> =>
      token.length < 20
        ? {
            usable: false,
            serverName: SERVER_NAME,
            username: null,
            email: null,
            message: 'This link has already been used.'
          }
        : {
            usable: true,
            serverName: SERVER_NAME,
            username: 'phantomduval',
            email: 'duval@example.com',
            message: 'Ready to use.'
          }
  })

  useAuth.setState({ user: USER, ready: true })

  const platform: Platform = {
    kind: 'web',
    copyText: (text) => navigator.clipboard.writeText(text),
    openLpEditor: ({ account, queueType, matchId }) =>
      navigate(paths.lpEditor(account, { queue: rankQueueParam(queueType), match: matchId })),
    // As the real page: only when the harness was started with YouTube on —
    // FOXFIRE_FEATURE_YOUTUBE=1 npm run dev:mock -w @foxfire/web.
    ...(YOUTUBE_ENABLED
      ? {
          watchRecording: ({ account, match }: RecordingTarget) => navigate(paths.recording(account, match.matchId)),
          // A stand-in with a running clock by default, which is enough to judge
          // the marker strip against and needs no network. ?youtube=real plays
          // the fixture video through YouTube's own player instead, to check the
          // IFrame API wiring end to end.
          youtube:
            new URLSearchParams(window.location.search).get('youtube') === 'real'
              ? createWebYouTubeMount()
              : createFakeYouTubeMount()
        }
      : {}),
    downloadReplay: async () => ({ ok: false, message: 'The harness has no blob store to download from.' }),
    statsDbImport: {
      pick: async () => ({ source: null, label: 'stats.db' }),
      run: (_source, onProgress) => runFixtureImport(onProgress)
    }
  }

  return { client, platform }
}
