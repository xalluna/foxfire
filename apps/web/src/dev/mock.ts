import type {
  ConnectionState,
  EmailConfirmation,
  FoxfireClient,
  InvitePreview,
  PasswordResetPreview,
  SessionUser,
  ShareLinkOpen,
  VersionInfo
} from '@foxfire/core'
import { ServerError } from '@foxfire/core/server'
import { isPlayer, paths, rankQueueParam } from '@foxfire/core/routes'
import type { Platform, RecordingTarget } from '@foxfire/screens'
import { createFakeYouTubeMount, createFixtureClient, runFixtureImport, scenario } from '@foxfire/screens/dev'
import { YOUTUBE_ENABLED } from '../features'
import { createWebYouTubeMount } from '../platform/youtubePlayer'
import { replaceServerInfoSource } from '../serverInfo'
import { useAuth } from '../session/session'
import { LAPSED } from '../session/share'

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
 *
 * Three scenarios start with nobody signed in. ?scenario=public-signed-out is an
 * open server, read by a visitor. ?scenario=shared-link is somebody who was
 * handed a link to Faker#NA1's profile, which is all the harness lets them
 * read — anybody else answers the way the server would, with a 401.
 * ?scenario=shared-link-ended is that link after its week is up.
 *
 * Two more are about who is at the keyboard. ?scenario=server-member is a member
 * who is no admin, to see the nav without Admin and /admin's "Administrators
 * only". ?scenario=server-fresh is the owner on the day the server was set up,
 * with nobody else in it and no mail provider yet.
 */

const SERVER_NAME = 'The Fox Den'

const PUBLIC_ACCESS = scenario === 'public-signed-out'

/** The profile ?scenario=shared-link was handed, as the server described it. */
const SHARED = { gameName: 'Faker', tagLine: 'NA1' }

// Faker is the configured head admin; ?scenario=server-admin signs in as Sova,
// a plain one, to see the pages the way they do, and ?scenario=server-member as
// phantomduval, who is no admin at all.
const USER: SessionUser =
  scenario === 'server-admin'
    ? { id: 'u-sova', username: 'Sova', email: 'sova@example.com', isAdmin: true, isHeadAdmin: false }
    : scenario === 'server-member'
      ? { id: 'u-2', username: 'phantomduval', email: 'duval@example.com', isAdmin: false, isHeadAdmin: false }
      : { id: 'u-faker', username: 'Faker', email: 'faker@example.com', isAdmin: true, isHeadAdmin: true }

const VERSION: VersionInfo = {
  serverName: SERVER_NAME,
  serverVersion: '0.2.0',
  apiVersion: 1,
  minimumDesktop: '0.12.0',
  recommendedDesktop: '0.12.0',
  // A server set up today starts invite-only.
  publicSignup: scenario !== 'server-fresh',
  apiBase: '/api',
  publicUrl: window.location.origin,
  // ?scenario=email-off is a server with no provider: no "Forgot password?".
  // So is ?scenario=server-fresh, which has not set one up yet.
  email: scenario !== 'email-off' && scenario !== 'server-fresh',
  publicAccess: PUBLIC_ACCESS
}

/** What the server says a share link refused to an outsider looks like. */
const membersOnly = (): Promise<never> => Promise.reject(new ServerError('Unauthorized', 401))

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
      publicAccess: PUBLIC_ACCESS,
      riotKeyRejected: false,
      upgradeRequired: null
    }
  }

  useAuth.subscribe(() => listeners.forEach((listener) => listener(connection())))

  // On a share link, signed out, the one profile and the games it played are
  // all there is; everybody else is the server's refusal.
  const onLinkOnly = (): boolean => scenario === 'shared-link' && useAuth.getState().user === null

  const client: FoxfireClient = {
    ...fixture,
    accounts: {
      ...fixture.accounts,
      find: (riotId) => (onLinkOnly() && !isPlayer(riotId, SHARED) ? membersOnly() : fixture.accounts.find(riotId))
    },
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
          },

    // The same answer whatever the address, as the server gives it.
    requestPasswordReset: async () => ({
      message:
        "If an account on this server uses that address and has confirmed it, a link to reset its password is on its way. It works for a day. Nothing arrived? Check your spam folder, or ask this server's administrator."
    }),

    // A short token is a link that was already used; anything longer confirms.
    confirmEmail: async (token): Promise<EmailConfirmation> => {
      if (token.length < 20) throw new Error('This link has already been used.')
      return {
        serverName: SERVER_NAME,
        email: 'faker@example.com',
        purpose: 'verify',
        message: 'Your email is confirmed. If you ever forget your password, you can reset it yourself from the sign-in page.'
      }
    },

    // A short token is a link that was withdrawn; anything longer opens Faker.
    openShare: async (token): Promise<ShareLinkOpen> =>
      token.length < 20
        ? {
            usable: false,
            message: 'This link was withdrawn. Ask whoever sent it for a new one.',
            reason: 'withdrawn',
            riotAccountId: null,
            gameName: null,
            tagLine: null,
            expiresAt: null
          }
        : {
            usable: true,
            message: 'Ready to use.',
            riotAccountId: '1',
            ...SHARED,
            expiresAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString()
          }
  })

  if (scenario === 'public-signed-out') {
    useAuth.setState({ user: null, ready: true, publicAccess: true })
  } else if (scenario === 'shared-link-ended') {
    useAuth.setState({ user: null, ready: true, share: null, shareRefused: LAPSED })
  } else if (scenario === 'shared-link') {
    useAuth.setState({
      user: null,
      ready: true,
      share: {
        token: 'harness-share-token-aaaaaaaa',
        accountId: '1',
        ...SHARED,
        expiresAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString()
      }
    })
  } else {
    useAuth.setState({ user: USER, ready: true })
  }

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
