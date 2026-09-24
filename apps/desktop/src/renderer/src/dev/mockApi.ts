import type { Api, ValidateResult } from '@shared/api'
import { windowRoutes } from '@shared/windowRoutes'
import type {
  Account,
  AppSettingsPublic,
  BackgroundSettings,
  CaptureSettings,
  CaptureStatus,
  EmailChange,
  LcuStatus,
  PasswordChange,
  QueueType,
  ObsValidation,
  Recording,
  RecordingDetail,
  RecordingDiskUsage,
  Replay,
  ReplayDiskUsage,
  ReplayLaunchResult,
  RoflSettings,
  ClientArchive,
  LiveClient,
  ArchiveResult,
  RiotKeyLimits,
  RiotKeyType,
  ServerAuthResult,
  ServerCredentials,
  ServerProbe,
  ServerRegistration,
  ServerState,
  InvitePreview,
  ImportProgress,
  UpdateState,
  AttachRecordingOutcome,
  BulkUploadResult,
  UploadDraft,
  YouTubeSettings,
  YouTubeState
} from '@shared/types'
import type {
  LcuTelemetry,
  RateLimitSeries,
  ResourceData,
  TelemetryRequest,
  TelemetryState,
  TelemetrySummary
} from '@shared/telemetry'
import {
  ACCOUNTS,
  MOCK_SERVER_URL,
  NOW,
  createFixtureClient,
  delay,
  runFixtureImport,
  scenario
} from '@foxfire/screens/dev'
import {
  DEFAULT_TITLE_TEMPLATE,
  UNMATCHED_TITLE_TEMPLATE,
  buildRecordingDescription,
  renderRecordingTitle
} from '@foxfire/core/youtube'
import {
  RECORDINGS,
  RECORDING_EVENTS,
  MOCK_REPLAYS,
  MOCK_ROFL_SETTINGS,
  MOCK_ARCHIVES
} from './desktopFixtures'

/**
 * The shared half: League data, a server's admin surface, and the events that
 * refresh them. The same fixture client the web client's harness renders, so
 * the two review the same games; what is added below is only what a desktop
 * has and a browser does not — and, connected, whose each account is.
 */
const fixture = createFixtureClient({ describe: ownedAs })

/**
 * The Google connection, as the three YouTube scenarios need it: a build with
 * no client in it, one with a client and nobody connected, and — everywhere
 * else — connected, so the upload form and the queue are what gets reviewed.
 */
let youtubeState: YouTubeState = {
  configured: scenario !== 'youtube-unconfigured',
  email: scenario === 'youtube-unconfigured' || scenario === 'youtube-disconnected' ? null : 'faker@example.com',
  connecting: false,
  error: null,
  pausedForGame: false,
  quotaResumesAt: scenario === 'youtube-queue' ? NOW + 5 * 60 * 60_000 : null
}
let youtubeSettings: YouTubeSettings = {
  autoUpload: false,
  defaultPrivacy: 'unlisted',
  titleTemplate: DEFAULT_TITLE_TEMPLATE
}
const youtubeListeners = new Set<(state: YouTubeState) => void>()

function setYouTubeState(patch: Partial<YouTubeState>): void {
  youtubeState = { ...youtubeState, ...patch }
  for (const listener of youtubeListeners) listener(youtubeState)
}

/**
 * A fake window.api for running the renderer in a plain browser.
 *
 * The real one is a contextBridge over IPC (src/preload/index.ts), so nothing
 * in the renderer works outside Electron. This stands in for it, typed as the
 * same `Api` interface, which means the compiler catches any drift between the
 * harness and the real IPC contract.
 *
 * Purpose is design work: the Electron app needs a live Riot key that expires
 * daily and a synced database before it shows anything, whereas this renders
 * every screen and every state instantly and deterministically.
 *
 * Dev-only — loaded lazily from main.tsx behind import.meta.env.DEV.
 */

/** Mutable, so toggling a setting in the harness actually sticks for the session. */
const CAPTURE_SETTINGS: CaptureSettings = {
  enabled: true,
  mode: 'managed',
  folder: 'D:\\Recordings',
  queues: [420, 440],
  otherQueues: false,
  audio: 'game',
  quality: '1080p60',
  softCapBytes: 50 * 1024 * 1024 * 1024,
  obsHost: '127.0.0.1',
  obsPort: 4455,
  hasObsPassword: true,
  obsInstallPath: null,
  obsScene: null
}

/** Listeners registered by the renderer for a rejected Riot key. */
const keyInvalidListeners = new Set<() => void>()

// Held in module state so the settings screen behaves like the real one: the
// control moves, the numbers stick, and nothing reaches a rate limiter that
// does not exist in the browser harness.
let keyType: RiotKeyType = 'personal'
let applicationLimits: RiotKeyLimits = { burstLimit: 500, sustainedLimit: 30_000 }

/**
 * The server connection, as module state so the harness behaves like the real
 * thing: connect, and the page rearranges; sign out, and it comes back.
 *
 * Reachable by ?scenario=server-connected, which is how the connected shape of
 * the Server settings page is reviewed without standing a .NET server up.
 */
let serverState: ServerState =
  scenario === 'server-connected' || scenario === 'server-degraded'
    ? {
        activeUrl: MOCK_SERVER_URL,
        publicUrl: MOCK_SERVER_URL,
        servers: [
          { url: MOCK_SERVER_URL, name: 'The Fox Den', username: 'Faker', isActive: true }
        ],
        session: {
          url: MOCK_SERVER_URL,
          username: 'Faker',
          email: 'faker@example.com',
          isAdmin: true
        },
        upgradeRequired: null,
        serverOutdated: false,
        riotKeyRejected: scenario === 'server-degraded'
      }
    : scenario === 'server-outdated' || scenario === 'server-behind'
      ? {
          // Signed in, and then the host upgraded their server out from under
          // this build — or, for server-behind, this build was updated past
          // the server. That is the shape worth designing for: the session is
          // still real, and it is the reads that stop.
          activeUrl: MOCK_SERVER_URL,
          publicUrl: MOCK_SERVER_URL,
          servers: [
            { url: MOCK_SERVER_URL, name: 'The Fox Den', username: 'Faker', isActive: true }
          ],
          session: {
            url: MOCK_SERVER_URL,
            username: 'Faker',
            email: 'faker@example.com',
            isAdmin: false
          },
          upgradeRequired: scenario === 'server-outdated' ? '0.14.0' : null,
          serverOutdated: scenario === 'server-behind',
          riotKeyRejected: false
        }
      : { activeUrl: null, servers: [], session: null, publicUrl: null, upgradeRequired: null,
        serverOutdated: false, riotKeyRejected: false }

const serverListeners = new Set<(state: ServerState) => void>()
const importListeners = new Set<(progress: ImportProgress) => void>()

function setServerState(next: ServerState): ServerState {
  serverState = next
  for (const listener of serverListeners) listener(next)
  return next
}

/** Accounts unlinked from Settings › Account this session: still tracked, nobody's. */
const released = new Set<string>()

/**
 * Whose an account is, the way a server answers. Connected, Faker is you and
 * any account the fixtures leave unowned is somebody else's — which is what the
 * rail, Search and Settings › Account tell apart. Locally nothing is anybody's,
 * as on a real local database, so the account passes through.
 *
 * A declaration rather than a const, because the fixture client above is built
 * with it before this line is reached.
 */
function ownedAs(account: Account): Account {
  if (serverState.session === null) return account
  if (released.has(account.id)) return { ...account, isMine: false, ownerUsername: null }
  if (account.isMine === undefined) return { ...account, isMine: false, ownerUsername: 'Chovy' }
  return account
}

/**
 * The patch notes an update carries, in the shape CHANGELOG.md is written in.
 *
 * Wrapped mid-sentence on purpose: the real notes arrive as the file was
 * typed, and the renderer has to put the lines back together.
 */
const UPDATE_NOTES = `Foxfire now updates itself.

### Added

- **Updates arrive on their own.** Foxfire checks for a new build, downloads it
  quietly, and offers to restart — never in the middle of a game.
- **Patch notes travel with the update**, so what changed is in the app.

### Fixed

- Starting with Windows no longer opens a window nobody asked for.`

/** What the updater is doing, per scenario. See the Scenario type. */
function mockUpdateState(): UpdateState {
  const base: UpdateState = {
    status: 'idle',
    current: '0.14.0',
    target: null,
    percent: null,
    notes: null,
    blockedBy: null,
    heldBy: null,
    error: null,
    justInstalled: null
  }

  switch (scenario) {
    case 'update-ready':
      return { ...base, status: 'ready', target: '0.15.0', notes: UPDATE_NOTES }
    case 'update-blocked':
      return {
        ...base,
        status: 'ready',
        target: '0.15.0',
        notes: UPDATE_NOTES,
        blockedBy: 'game'
      }
    case 'update-downloading':
      return { ...base, status: 'downloading', target: '0.15.0', percent: 45 }
    case 'update-held':
      return {
        ...base,
        heldBy: { serverName: 'Late Night', allows: '0.14.0', newest: '0.15.0' }
      }
    case 'just-installed':
      return {
        ...base,
        notes: UPDATE_NOTES,
        justInstalled: { version: '0.14.0', notes: UPDATE_NOTES }
      }
    default:
      return base
  }
}

let updateState = mockUpdateState()
const updateListeners = new Set<(state: UpdateState) => void>()

function setUpdateState(next: UpdateState): void {
  updateState = next
  for (const listener of updateListeners) listener(next)
}

export const mockApi: Api = {
  // The browser harness has no Electron and so no real path for a File.
  pathForFile: () => null,
  app: {
    // The harness has no main process to ask, so this is the browser-only
    // stand-in; the packaged app reads it from app.getVersion().
    // Never held, even in the loading scenario — this is chrome, not data.
    getVersion: (): Promise<string> => delay(updateState.current, 0, false)
  },
  updates: {
    getState: (): Promise<UpdateState> => delay(updateState, 0, false),
    // No feed to ask in a browser, so this is the shape of the round trip
    // rather than its outcome: checking, then whatever was already true.
    check: async (): Promise<UpdateState> => {
      const settled = updateState
      setUpdateState({ ...settled, status: 'checking' })
      await delay(null, 700, false)
      setUpdateState(settled)
      return settled
    },
    // Nothing to restart into. The harness is here to look at the offer.
    restart: (): Promise<void> => delay(undefined, 0, false),
    dismissNote: async (): Promise<void> => {
      setUpdateState({ ...updateState, justInstalled: null })
    },
    onChanged: (cb) => {
      updateListeners.add(cb)
      return () => updateListeners.delete(cb)
    }
  },
  server: {
    getState: (): Promise<ServerState> => delay(serverState, 120, false),

    probe: (url: string): Promise<ServerProbe> =>
      delay(
        url.includes('unreachable')
          ? {
              url,
              reachable: false,
              error: `Nothing found at ${url}. Check the address.`,
              serverName: null,
              serverVersion: null,
              apiVersion: null,
              minimumDesktop: null,
              recommendedDesktop: null,
              publicSignup: null,
              publicUrl: null,
              compatibility: 'unknown'
            }
          : {
              url,
              reachable: true,
              error: null,
              serverName: 'The Fox Den',
              serverVersion: '0.1.0',
              apiVersion: 1,
              minimumDesktop: '0.12.0',
              recommendedDesktop: '0.12.0',
              publicSignup: !url.includes('invite-only'),
              publicUrl: url,
              // "too-old" is this build behind the server; "old-server" is the
              // server behind this build.
              compatibility: url.includes('too-old')
                ? 'unsupported'
                : url.includes('old-server')
                  ? 'server-outdated'
                  : 'ok'
            },
        400,
        false
      ),

    previewInvite: (_url: string, token: string): Promise<InvitePreview> =>
      delay(
        token.length < 20
          ? {
              usable: false,
              serverName: 'The Fox Den',
              email: null,
              message: 'This invite link is not valid for this server.'
            }
          : {
              usable: true,
              serverName: 'The Fox Den',
              email: 'invitee@example.com',
              message: 'Ready to use.'
            },
        350,
        false
      ),

    register: (url: string, registration: ServerRegistration): Promise<ServerAuthResult> =>
      delay(
        {
          ok: true,
          error: null,
          state: setServerState({
            activeUrl: url,
            servers: [
              { url, name: 'The Fox Den', username: registration.username, isActive: true }
            ],
            session: {
              url,
              username: registration.username,
              email: registration.email,
              isAdmin: false
            },
            publicUrl: url,
            upgradeRequired: null,
            serverOutdated: false,
            riotKeyRejected: false
          })
        },
        600,
        false
      ),

    login: (url: string, credentials: ServerCredentials): Promise<ServerAuthResult> =>
      delay(
        credentials.password === 'wrong'
          ? {
              ok: false,
              error: 'Wrong email or password.',
              state: serverState
            }
          : {
              ok: true,
              error: null,
              state: setServerState({
                activeUrl: url,
                servers: [{ url, name: 'The Fox Den', username: 'Faker', isActive: true }],
                session: {
                  url,
                  username: 'Faker',
                  email: credentials.email,
                  isAdmin: true
                },
                publicUrl: url,
                upgradeRequired: null,
                serverOutdated: false,
                riotKeyRejected: false
              })
            },
        600,
        false
      ),

    logout: (): Promise<ServerState> =>
      delay(
        setServerState({
          activeUrl: null,
          servers: serverState.servers.map((s) => ({ ...s, username: null, isActive: false })),
          session: null,
          publicUrl: null,
          upgradeRequired: null,
          serverOutdated: false,
          riotKeyRejected: false
        }),
        300,
        false
      ),

    // The account forms, answered the way the server would: the wrong current
    // password is refused, everything else is accepted and shows up in the
    // "Signed in" card.
    changePassword: ({ currentPassword }: PasswordChange): Promise<ServerAuthResult> =>
      delay(
        currentPassword === 'wrong'
          ? { ok: false, error: 'That is not your current password.', state: serverState }
          : { ok: true, error: null, state: serverState },
        300,
        false
      ),

    changeEmail: ({ email, currentPassword }: EmailChange): Promise<ServerAuthResult> =>
      delay(
        currentPassword === 'wrong'
          ? { ok: false, error: 'That is not your current password.', state: serverState }
          : {
              ok: true,
              error: null,
              state: setServerState({
                ...serverState,
                session: serverState.session ? { ...serverState.session, email } : null
              })
            },
        300,
        false
      ),

    changeUsername: (username: string): Promise<ServerAuthResult> =>
      delay(
        {
          ok: true,
          error: null,
          state: setServerState({
            ...serverState,
            session: serverState.session ? { ...serverState.session, username } : null
          })
        },
        300,
        false
      ),

    setActive: (url: string | null): Promise<ServerState> =>
      delay(
        setServerState({
          ...serverState,
          activeUrl: url,
          servers: serverState.servers.map((s) => ({ ...s, isActive: s.url === url })),
          publicUrl: url,
          upgradeRequired: null,
          serverOutdated: false,
          riotKeyRejected: false
        }),
        200,
        false
      ),

    forget: (url: string): Promise<ServerState> =>
      delay(
        setServerState({
          activeUrl: serverState.activeUrl === url ? null : serverState.activeUrl,
          servers: serverState.servers.filter((s) => s.url !== url),
          session: serverState.session?.url === url ? null : serverState.session,
          publicUrl: serverState.activeUrl === url ? null : serverState.publicUrl,
          upgradeRequired: null,
          serverOutdated: false,
          riotKeyRejected: false
        }),
        200,
        false
      ),

    onChanged: (cb: (state: ServerState) => void): (() => void) => {
      serverListeners.add(cb)
      return () => serverListeners.delete(cb)
    }
  },
  serverAdmin: {
    ...fixture.admin,

    // The harness has no file system and no server, so the import is the one
    // shape the panel has to draw for real: a run that reports its way through
    // the phases and finishes with a tally.
    chooseDatabase: (): Promise<string | null> => delay('C:\\Users\\you\\stats.db', 400, false),
    importDatabase: () =>
      runFixtureImport((progress: ImportProgress) => importListeners.forEach((cb) => cb(progress))),
    onImportProgress: (cb: (progress: ImportProgress) => void): (() => void) => {
      importListeners.add(cb)
      return () => importListeners.delete(cb)
    }
  },
  settings: {
    get: (): Promise<AppSettingsPublic> =>
      delay(
        {
          hasApiKey: scenario !== 'no-key',
          homeAccountId: scenario === 'no-accounts' ? null : 1,
          keyRejected: scenario === 'key-expired',
          keyType,
          applicationLimits
        },
        180,
        false
      ),
    setApiKey: (key: string): Promise<ValidateResult> =>
      delay(
        key.startsWith('RGAPI-')
          ? { ok: true }
          : { ok: false, message: 'That does not look like a Riot API key.' },
        600
      ),
    clearApiKey: (): Promise<AppSettingsPublic> =>
      delay({ hasApiKey: false, homeAccountId: 1, keyRejected: false, keyType, applicationLimits }),
    setKeyType: (next: RiotKeyType, limits?: RiotKeyLimits): Promise<AppSettingsPublic> => {
      keyType = next
      if (limits) applicationLimits = limits
      return delay(
        {
          hasApiKey: scenario !== 'no-key',
          homeAccountId: scenario === 'no-accounts' ? null : 1,
          keyRejected: scenario === 'key-expired',
          keyType,
          applicationLimits
        },
        180
      )
    },
    onKeyInvalid: (cb: () => void) => {
      keyInvalidListeners.add(cb)
      // Fire once on load so the expired-key banner can be inspected.
      if (scenario === 'key-expired') setTimeout(cb, 500)
      return () => keyInvalidListeners.delete(cb)
    }
  },

  accounts: {
    ...fixture.accounts,
    // On a server, removing is giving up the claim: the account stays, nobody's.
    remove: async (accountId: string): Promise<Account[]> => {
      if (serverState.session === null) return fixture.accounts.remove(accountId)
      released.add(accountId)
      return fixture.accounts.mine()
    },
    add: (input): Promise<Account> =>
      delay(
        {
          ...ACCOUNTS[0],
          id: String(Date.now()),
          puuid: `puuid-${input.gameName}`,
          gameName: input.gameName,
          tagLine: input.tagLine,
          isHomeAccount: false
        },
        700
      ),
    // Claiming, in the harness, is whichever account the fake League client is
    // signed in to becoming yours.
    link: (input): Promise<Account> =>
      delay(
        {
          ...ACCOUNTS[0],
          id: String(Date.now()),
          puuid: `puuid-${input.gameName}`,
          gameName: input.gameName,
          tagLine: input.tagLine,
          isHomeAccount: false,
          isMine: true,
          ownerUsername: 'Faker'
        },
        700
      )
  },

  dashboard: fixture.dashboard,

  sync: {
    ...fixture.sync,
    onProgress: fixture.events.onSyncProgress
  },

  assets: fixture.assets,

  champions: fixture.champions,
  seasons: fixture.seasons,
  mastery: fixture.mastery,

  rank: {
    ...fixture.rank,

    // There are no windows in a browser, so the editor takes over the page
    // instead: the window's route is a route like any other, and the router
    // follows the hash to it exactly as the real window loads it.
    openEditor: (accountId: string, queueType: QueueType, matchId: string): Promise<void> => {
      window.location.hash = `#${windowRoutes.lpEditor(accountId, queueType, matchId)}`
      return Promise.resolve()
    },

    onEdited: fixture.events.onRankEdited,
    // Only fires when a second right-click reaches an already-open window,
    // which cannot happen with a single page.
    onEditorFocus: () => () => {}
  },


  // The browser harness has no League client and no Electron main process, so
  // these report the states the renderer must handle rather than pretending to
  // be connected: a disconnected client, background features switched off.
  lcu: {
    getStatus: (): Promise<LcuStatus> =>
      delay(
        scenario === 'not-live'
          ? { state: 'disconnected' }
          : {
              state: 'connected',
              accountId: '1',
              gameName: 'Faker',
              tagLine: 'NA1',
              // A game in progress in the default scenario, to match the
              // capture status below, which is recording one.
              inGame: true
            },
        100
      ),
    onStatus: () => () => {},
    onRankChanged: fixture.events.onRankChanged
  },

  background: {
    get: (): Promise<BackgroundSettings> =>
      delay({ runInTray: false, launchAtStartup: false, lcuInstallPath: null }, 100),
    set: (patch): Promise<BackgroundSettings> =>
      delay({ runInTray: false, launchAtStartup: false, lcuInstallPath: null, ...patch }, 150)
  },

  search: fixture.search,
  /**
   * The panel opens at `#/telemetry` in its own window against the real main
   * process, so the browser harness cannot produce genuine measurements. It
   * serves a synthetic backfill instead — the shape the panel exists to show:
   * queue wait climbing as the sustained window saturates, a couple of 429s,
   * and one schema drift.
   *
   * Without this the panel would only ever be reviewable by running a live
   * 4-minute sync against a key that expires daily.
   */
  /**
   * Capture, as it looks on a machine with OBS running and set up. The 'no-obs'
   * scenario is the other half — the state most people will meet first.
   */
  capture: {
    getSettings: (): Promise<CaptureSettings> => delay(CAPTURE_SETTINGS, 150, false),
    set: (patch: Partial<CaptureSettings>): Promise<CaptureSettings> => {
      Object.assign(CAPTURE_SETTINGS, patch)
      return delay({ ...CAPTURE_SETTINGS }, 100, false)
    },
    setObsPassword: (): Promise<CaptureSettings> => {
      CAPTURE_SETTINGS.hasObsPassword = true
      return delay({ ...CAPTURE_SETTINGS }, 100, false)
    },
    clearObsPassword: (): Promise<CaptureSettings> => {
      CAPTURE_SETTINGS.hasObsPassword = false
      return delay({ ...CAPTURE_SETTINGS }, 100, false)
    },
    chooseFolder: (): Promise<string | null> => delay('D:\\Recordings', 200, false),
    chooseObsPath: (): Promise<string | null> =>
      delay('C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe', 200, false),
    getStatus: (): Promise<CaptureStatus> =>
      delay(
        scenario === 'no-obs'
          ? { state: 'error', message: 'No OBS listening — is it running?' }
          : scenario === 'not-live'
            ? { state: 'idle' }
            : { state: 'recording', recordingId: 1, startedAt: Date.now() - 640_000 },
        120,
        false
      ),
    onStatus: () => () => undefined,
    validate: (): Promise<ObsValidation> =>
      delay(
        scenario === 'no-obs'
          ? { ok: false, problems: [{ kind: 'notConnected' }], scenes: [], audioInputs: [] }
          : {
              ok: CAPTURE_SETTINGS.mode === 'managed',
              // Manual mode with a scene nobody has picked yet — the state a
              // first-time user actually lands in.
              problems:
                CAPTURE_SETTINGS.mode === 'managed' ? [] : [{ kind: 'sceneNotChosen' as const }],
              scenes: ['Streaming', 'League', 'Just Chatting'],
              audioInputs: [
                { name: 'Desktop Audio', muted: false },
                { name: 'Mic/Aux', muted: true }
              ]
            },
        200,
        false
      ),
    // No OBS to screenshot in a browser, so the empty-preview copy is what the
    // harness exercises.
    preview: (): Promise<string | null> => delay(null, 200, false),
    reconnect: (): Promise<CaptureStatus> => delay({ state: 'connecting' }, 100, false)
  },
  recordings: {
    list: (accountId: string): Promise<Recording[]> => delay(RECORDINGS[accountId] ?? [], 220),
    detail: (recordingId: number): Promise<RecordingDetail | null> => {
      const recording = (RECORDINGS[1] ?? []).find((item) => item.id === recordingId)
      return delay(recording ? { recording, events: RECORDING_EVENTS } : null, 220)
    },
    usage: (): Promise<RecordingDiskUsage> =>
      delay(
        {
          totalBytes: 3_180_000_000,
          count: 3,
          unmatchedCount: 1,
          missingCount: 1,
          softCapBytes: 50 * 1024 * 1024 * 1024
        },
        180,
        false
      ),
    remove: (): Promise<void> => delay(undefined, 120, false),
    removeOldest: (): Promise<number> => delay(1, 200, false),
    open: (): Promise<void> => delay(undefined, 0, false),
    reveal: (): Promise<void> => delay(undefined, 0, false),
    onChanged: () => () => undefined,
    showMatch: (): Promise<void> => delay(undefined, 0, false),
    onShowMatch: () => () => undefined,
    forget: (): Promise<void> => delay(undefined, 120, false),
    // The harness has one window, so a recording "window" is a navigation in
    // it, the way the LP editor's is.
    openRemote: (accountId: string, matchId: string): Promise<void> => {
      window.location.hash = `#${windowRoutes.remoteRecording(accountId, matchId)}`
      return delay(undefined, 0, false)
    }
  },
  matchRecordings: {
    ...fixture.matchRecordings!,
    onChanged: fixture.events.onRecordingChanged
  },
  youtube: {
    getState: (): Promise<YouTubeState> => delay(youtubeState, 120, false),
    connect: async (): Promise<void> => {
      setYouTubeState({ connecting: true, error: null })
      await delay(undefined, 1_200, false)
      setYouTubeState({ connecting: false, email: 'faker@example.com' })
    },
    cancelConnect: async (): Promise<void> => setYouTubeState({ connecting: false }),
    disconnect: async (): Promise<void> => setYouTubeState({ email: null }),
    getSettings: (): Promise<YouTubeSettings> => delay(youtubeSettings, 120, false),
    setSettings: (patch: Partial<YouTubeSettings>): Promise<YouTubeSettings> => {
      youtubeSettings = { ...youtubeSettings, ...patch }
      return delay(youtubeSettings, 120, false)
    },
    draft: (recordingId: number): Promise<UploadDraft> => {
      const recording = (RECORDINGS[1] ?? []).find((item) => item.id === recordingId)
      const match = recording?.match
      return delay(
        {
          recordingId,
          title: renderRecordingTitle(match ? youtubeSettings.titleTemplate : UNMATCHED_TITLE_TEMPLATE, {
            champion: match?.championName ?? 'Ahri',
            queueId: match?.queueId ?? recording?.queueId ?? null,
            gameMode: match?.gameMode ?? null,
            win: match ? match.win : null,
            kills: match?.kills ?? null,
            deaths: match?.deaths ?? null,
            assists: match?.assists ?? null,
            playedAt: recording?.startedAt ?? NOW
          }),
          description: buildRecordingDescription(RECORDING_EVENTS),
          privacy: youtubeSettings.defaultPrivacy,
          durationSeconds: recording?.durationSeconds ?? null
        },
        250,
        false
      )
    },
    enqueue: (): Promise<void> => delay(undefined, 200, false),
    enqueueMany: (recordingIds: number[]): Promise<BulkUploadResult> =>
      delay({ queued: recordingIds.length, skipped: [] }, 400, false),
    cancel: (): Promise<void> => delay(undefined, 100, false),
    retry: (): Promise<void> => delay(undefined, 100, false),
    attachLink: (): Promise<AttachRecordingOutcome> => delay({ ok: true }, 400, false),
    reattach: (): Promise<AttachRecordingOutcome> => delay({ ok: true }, 400, false),
    onChanged: (cb) => {
      youtubeListeners.add(cb)
      return () => youtubeListeners.delete(cb)
    }
  },
  // Riot replays. The fixtures deliberately cover the three states the tab has
  // to draw: linked and playable, linked but on a patch nothing can play, and
  // ingested with no match yet.
  replays: {
    list: (): Promise<Replay[]> => delay(MOCK_REPLAYS, 220),
    // The harness has no server behind it, so there is never one to fetch —
    // which is also what local-only mode answers.
    download: (): Promise<number | null> => delay(null, 400, false),
    usage: (): Promise<ReplayDiskUsage> =>
      delay(
        {
          totalBytes: 96_000_000,
          count: 3,
          unlinkedCount: 1,
          missingCount: 0,
          unplayableCount: 1,
          softCapBytes: 5 * 1024 * 1024 * 1024
        },
        180,
        false
      ),
    open: (replayId: number): Promise<ReplayLaunchResult> => {
      const replay = MOCK_REPLAYS.find((item) => item.id === replayId)
      return delay(
        replay?.blockedReason == null
          ? { ok: true }
          : { ok: false, reason: replay.blockedReason, attemptedCommand: null },
        200,
        false
      )
    },
    reveal: (): Promise<void> => delay(undefined, 0, false),
    remove: (): Promise<void> => delay(undefined, 120, false),
    add: (): Promise<{ ok: boolean; replay: Replay | null }> =>
      delay({ ok: true, replay: MOCK_REPLAYS[0] ?? null }, 300, false),
    link: (): Promise<void> => delay(undefined, 120, false),
    rescan: (): Promise<number> => delay(0, 600, false),
    settings: (): Promise<RoflSettings> => delay(MOCK_ROFL_SETTINGS, 160),
    setSettings: (patch): Promise<RoflSettings> =>
      delay({ ...MOCK_ROFL_SETTINGS, ...patch }, 120, false),
    chooseSourceFolder: (): Promise<string | null> => delay(null, 0, false),
    onChanged: () => () => undefined,
    onImportProgress: () => () => undefined
  },
  archives: {
    list: (): Promise<ClientArchive[]> => delay(MOCK_ARCHIVES, 200),
    add: (): Promise<ArchiveResult> => delay({ ok: true }, 300, false),
    remove: (): Promise<void> => delay(undefined, 120, false),
    setPatch: (): Promise<{ ok: boolean; error?: string }> => delay({ ok: true }, 120, false),
    live: (): Promise<LiveClient> =>
      delay({ path: 'C:\\Riot Games\\League of Legends', patch: '16.16' }, 200),
    choosePath: (): Promise<string | null> => delay(null, 0, false),
    archiveLive: (): Promise<ArchiveResult> => delay({ ok: true }, 600, false),
    cancelCopy: (): Promise<void> => delay(undefined, 0, false),
    onCopyProgress: () => () => undefined,
    openWindow: (): Promise<void> => delay(undefined, 0, false)
  },
  telemetry: {
    getState: () => delay(MOCK_TELEMETRY_STATE, 0),
    setEnabled: (enabled: boolean) => delay({ ...MOCK_TELEMETRY_STATE, enabled }, 0),
    openWindow: () => delay(undefined, 0),
    clear: () => delay({ ...MOCK_TELEMETRY_STATE, dbBytes: 0 }, 0),
    requests: (query) =>
      delay(
        MOCK_REQUESTS.filter(
          (row) =>
            (!query.endpoint || row.endpoint === query.endpoint) &&
            (!query.outcome || row.outcome === query.outcome)
        ).slice(0, query.limit ?? 200),
        120
      ),
    endpoints: () => delay([...new Set(MOCK_REQUESTS.map((r) => r.endpoint))].sort(), 0),
    summary: (windowMs: number) => delay(mockSummary(windowMs), 150),
    rateLimit: (windowMs: number) => delay(mockRateLimit(windowMs), 150),
    resources: (windowMs: number) => delay(mockResources(windowMs), 150),
    lcu: (windowMs: number) => delay(mockLcu(windowMs), 100),
    // Both act on the real database through the main process, so in the browser
    // harness they can only report a plausible shape for the buttons.
    replayAttribution: () => delay(3, 200),
    simulateGameEnd: () => delay(true, 100)
  }
}

const MOCK_TELEMETRY_STATE: TelemetryState = {
  enabled: true,
  dbPath: 'C:\\Users\\dev\\AppData\\Roaming\\Foxfire\\data\\telemetry.db',
  pending: 14,
  dropped: 0,
  dbBytes: 4_812_544
}

/**
 * A synthetic 200-match backfill. Deterministic, so the panel looks the same on
 * every reload and visual changes are attributable to the code rather than the
 * data.
 */
const MOCK_REQUESTS: TelemetryRequest[] = buildMockRequests()

function buildMockRequests(): TelemetryRequest[] {
  const rows: TelemetryRequest[] = []
  const now = Date.now()

  for (let i = 0; i < 180; i += 1) {
    const startedAt = now - i * 1_180 - (i % 7) * 90
    // Queue wait grows as the 100-per-2-minute window fills; network time
    // wobbles around Riot's typical sub-500ms.
    const waitMs = i < 18 ? 4 + (i % 5) * 3 : 900 + ((i * 37) % 1_400)
    const networkMs = 120 + ((i * 53) % 320)

    const throttled = i === 41 || i === 96
    const drifted = i === 63
    const isPage = i % 60 === 0

    rows.push({
      id: 5_000 - i,
      requestId: `req-${5_000 - i}`,
      spanId: `span-sync-${Math.floor(i / 60)}`,
      attempt: throttled ? 2 : 1,
      endpoint: isPage
        ? '/lol/match/v5/matches/by-puuid/{puuid}/ids'
        : '/lol/match/v5/matches/{matchId}',
      pathHash: (0x9e3779b9 * (i + 1)).toString(16).slice(0, 16),
      host: 'https://americas.api.riotgames.com',
      scheduledAt: startedAt - waitMs,
      startedAt,
      waitMs,
      networkMs,
      status: throttled ? 429 : drifted ? 200 : 200,
      outcome: throttled ? 'http_error' : drifted ? 'parse_error' : 'ok',
      bytes: isPage ? 2_140 : 96_000 + ((i * 811) % 40_000),
      errorKind: throttled ? 'RiotApiError' : drifted ? 'ZodError' : null,
      errorMessage: throttled
        ? 'Riot API error 429 for /lol/match/v5/matches/{matchId}'
        : drifted
          ? 'Invalid input: expected number, received undefined at info.participants[3].challenges'
          : null,
      appLimit: '20:1,100:120',
      appLimitCount: `${Math.min(100, 12 + ((i * 3) % 92))}:120`,
      methodLimit: '250:10',
      methodLimitCount: `${8 + (i % 40)}:10`,
      retryAfterMs: throttled ? 2_000 : null
    })
  }

  // A fan-out: ten rank lookups issued at once, queued serially.
  for (let i = 0; i < 10; i += 1) {
    rows.push({
      id: 4_800 - i,
      requestId: `req-live-${i}`,
      spanId: null,
      attempt: 1,
      endpoint: '/lol/league/v4/entries/by-puuid/{puuid}',
      pathHash: (0x85ebca6b * (i + 3)).toString(16).slice(0, 16),
      host: 'https://na1.api.riotgames.com',
      scheduledAt: now - 240_000,
      startedAt: now - 240_000 + i * 310,
      // The whole point of the fan-out: each request waits for all the ones
      // ahead of it, so wait climbs linearly while network stays flat.
      waitMs: i * 310,
      networkMs: 180 + ((i * 29) % 60),
      status: 200,
      outcome: 'ok',
      bytes: 1_180,
      errorKind: null,
      errorMessage: null,
      appLimit: '20:1,100:120',
      appLimitCount: `${60 + i}:120`,
      methodLimit: '250:10',
      methodLimitCount: `${i + 1}:10`,
      retryAfterMs: null
    })
  }

  return rows.sort((a, b) => b.startedAt - a.startedAt)
}

function mockSummary(windowMs: number): TelemetrySummary {
  const waits = MOCK_REQUESTS.map((r) => r.waitMs).sort((a, b) => a - b)
  const nets = MOCK_REQUESTS.map((r) => r.networkMs).sort((a, b) => a - b)
  const at = (values: number[], p: number): number =>
    values[Math.max(0, Math.ceil((p / 100) * values.length) - 1)]

  const byEndpoint = [...new Set(MOCK_REQUESTS.map((r) => r.endpoint))].map((endpoint) => {
    const subset = MOCK_REQUESTS.filter((r) => r.endpoint === endpoint)
    const subNets = subset.map((r) => r.networkMs).sort((a, b) => a - b)
    const subWaits = subset.map((r) => r.waitMs).sort((a, b) => a - b)
    return {
      endpoint,
      requests: subset.length,
      errors: subset.filter((r) => r.outcome !== 'ok').length,
      waitP95: at(subWaits, 95),
      netP50: at(subNets, 50),
      netP95: at(subNets, 95),
      bytes: subset.reduce((sum, r) => sum + (r.bytes ?? 0), 0)
    }
  })

  return {
    windowMs,
    attempts: MOCK_REQUESTS.length,
    logicalRequests: MOCK_REQUESTS.length - 2,
    errors: MOCK_REQUESTS.filter((r) => r.outcome !== 'ok').length,
    throttled: MOCK_REQUESTS.filter((r) => r.status === 429).length,
    bytes: MOCK_REQUESTS.reduce((sum, r) => sum + (r.bytes ?? 0), 0),
    waitP50: at(waits, 50),
    waitP95: at(waits, 95),
    netP50: at(nets, 50),
    netP95: at(nets, 95),
    byEndpoint
  }
}

/** 120 evenly spaced timestamps across the requested window. */
function mockBuckets(windowMs: number, count = 120): number[] {
  const now = Date.now()
  const step = windowMs / count
  return Array.from({ length: count }, (_, i) => Math.round(now - windowMs + i * step))
}

function mockRateLimit(windowMs: number): RateLimitSeries {
  const buckets = mockBuckets(windowMs)
  // The sustained window saturates during a backfill and the burst window does
  // not — which is exactly the shape that says "the 100/2min limit is what's
  // pacing this, not the 20/s one".
  return {
    app: [
      {
        windowSeconds: 1,
        limit: 20,
        points: buckets.map((at, i) => ({ at, count: 1 + (i % 4) }))
      },
      {
        windowSeconds: 120,
        limit: 100,
        points: buckets.map((at, i) => ({
          at,
          count: i < 20 ? 8 + i * 3 : Math.min(100, 82 + ((i * 7) % 20))
        }))
      }
    ],
    method: [
      {
        windowSeconds: 10,
        limit: 250,
        points: buckets.map((at, i) => ({ at, count: 30 + ((i * 11) % 60) }))
      }
    ],
    throttledAt: [buckets[46], buckets[97]]
  }
}

function mockResources(windowMs: number): ResourceData {
  const buckets = mockBuckets(windowMs)
  const wave = (i: number, base: number, amp: number, period: number): number =>
    Number((base + amp * Math.abs(Math.sin((i / period) * Math.PI))).toFixed(2))

  return {
    series: [
      {
        processType: 'Browser',
        // Working set is in KB, as Electron reports it — ~150MB climbing
        // slightly over the run, which is roughly what a backfill looks like.
        points: buckets.map((at, i) => ({
          at,
          cpuPercent: wave(i, 3, 22, 17),
          workingSetKb: Math.round(148_000 + i * 90 + wave(i, 0, 6_000, 23))
        }))
      },
      {
        processType: 'Tab',
        points: buckets.map((at, i) => ({
          at,
          cpuPercent: wave(i, 1, 9, 11),
          workingSetKb: Math.round(212_000 + wave(i, 0, 14_000, 31))
        }))
      },
      {
        processType: 'GPU',
        points: buckets.map((at, i) => ({
          at,
          cpuPercent: wave(i, 0.5, 3, 7),
          workingSetKb: Math.round(78_000 + wave(i, 0, 3_000, 13))
        }))
      }
    ],
    // The spikes line up with the synchronous match inserts during backfill.
    loopDelay: buckets.map((at, i) => ({
      at,
      meanMs: wave(i, 1.2, 3, 19),
      p99Ms: i % 17 === 0 ? wave(i, 40, 90, 5) : wave(i, 6, 14, 19),
      maxMs: i % 17 === 0 ? wave(i, 90, 160, 5) : wave(i, 12, 22, 19),
      queueDepth: i > 18 && i < 100 ? Math.max(0, 60 - Math.abs(60 - i)) : 0
    }))
  }
}

function mockLcu(windowMs: number): LcuTelemetry {
  const buckets = mockBuckets(windowMs, 30)
  const now = Date.now()
  return {
    latency: buckets.map((at, i) => ({ at, ms: 6 + ((i * 5) % 14) })),
    recent: [
      { at: now - 180_000, kind: 'connected', latencyMs: null, detail: 'connected' },
      {
        at: now - 900_000,
        kind: 'error',
        latencyMs: null,
        detail: 'Error: connect ECONNREFUSED 127.0.0.1:52841'
      },
      { at: now - 960_000, kind: 'disconnected', latencyMs: null, detail: 'disconnected' }
    ]
  }
}

export function installMockApi(): void {
  window.api = mockApi
  document.documentElement.dataset.harness = scenario
}
