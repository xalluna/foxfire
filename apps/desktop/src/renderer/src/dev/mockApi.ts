import type { Api, DashboardData, MasteryData, ValidateResult } from '@shared/api'
import type {
  Account,
  AdminActionResult,
  AdminInvite,
  AdminUser,
  AdminReplay,
  AdminUserPatch,
  ServerStorageUsage,
  ImportProgress,
  ImportResult,
  AdHocSummonerResult,
  AppSettingsPublic,
  AssetManifest,
  BackgroundSettings,
  CaptureSettings,
  CaptureStatus,
  ChampionStats,
  LcuStatus,
  MatchDetail,
  InvitePreview,
  MatchSummary,
  QueueType,
  ObsValidation,
  RankHistory,
  RankRange,
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
  ServerAdminSettings,
  ServerProbe,
  ServerRegistration,
  ServerState,
  Scoreboard,
  Season,
  SeasonInput,
  SyncProgressEvent,
  SyncState
} from '@shared/types'
import type {
  LcuTelemetry,
  RateLimitSeries,
  ResourceData,
  TelemetryRequest,
  TelemetryState,
  TelemetrySummary
} from '@shared/telemetry'
import { rankMovement } from '@shared/ladder'
import { rangeBounds, resetsBetween, seasonsSpanning } from '@shared/seasons'
import { DEV_SEASONS } from './seasons'
import { DDRAGON_MANIFEST } from './ddragonManifest'
import {
  RECORDINGS,
  RECORDING_EVENTS,
  MOCK_REPLAYS,
  MOCK_ROFL_SETTINGS,
  MOCK_ARCHIVES,
  ACCOUNTS,
  LEAGUE_ENTRIES,
  MASTERY,
  MATCHES,
  MATCH_DETAILS,
  RANK_SNAPSHOTS,
  SCOREBOARD,
  championStatsFor
} from './fixtures'
import { clearManualRank, editableMatches, saveManualRanks } from './manualRank'

/**
 * Stands in for the main process broadcasting rank:edited to every window.
 * Here there is only one, but the match list and rank graph still have to be
 * told to refetch after an edit.
 */
const editedListeners = new Set<(accountId: string) => void>()

function notifyEdited(accountId: string): void {
  for (const listener of editedListeners) listener(accountId)
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

/**
 * Scenario switch, read from ?scenario= in the URL.
 *
 * The states below are not rare edge cases in this app: a personal Riot key
 * expires every 24 hours, so no-key and key-expired are part of ordinary use
 * and need to be as designed as the happy path.
 */
export type Scenario =
  | 'default'
  | 'loading'
  | 'no-key'
  | 'key-expired'
  | 'no-accounts'
  | 'no-matches'
  | 'sync-error'
  | 'not-live'
  | 'no-obs'
  // Signed in to a Foxfire server; refused by one for being too old; and one
  // whose own Riot key has expired, which is the state a personal key reaches
  // every twenty-four hours and which nobody on this machine can fix.
  | 'server-connected'
  | 'server-outdated'
  | 'server-degraded'

function currentScenario(): Scenario {
  const raw = new URLSearchParams(window.location.search).get('scenario')
  return (raw ?? 'default') as Scenario
}

const scenario = currentScenario()

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

/** Never resolves — holds the UI in its loading state for inspection. */
const NEVER = new Promise<never>(() => {})

/**
 * `hold: false` opts a call out of the `loading` scenario.
 *
 * The shell needs its accounts, settings and asset manifest to resolve before
 * any screen renders at all, so stalling those would only ever show the
 * "no accounts" state. Holding just the data queries reproduces the state that
 * actually matters: a populated app waiting on its match list.
 */
function delay<T>(value: T, ms = 180, hold = true): Promise<T> {
  if (scenario === 'loading' && hold) return NEVER
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function fail(message: string): Promise<never> {
  if (scenario === 'loading') return NEVER
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 180))
}

const KEY_EXPIRED = 'Riot API returned 401 — your key has expired.'

function accounts(): Account[] {
  return scenario === 'no-accounts' ? [] : ACCOUNTS
}

function matchesFor(accountId: string): MatchSummary[] {
  if (scenario === 'no-matches') return []
  return MATCHES[accountId] ?? []
}

function syncState(accountId: string): SyncState {
  return {
    accountId,
    mostRecentMatchId: matchesFor(accountId)[0]?.matchId ?? null,
    backfillComplete: scenario !== 'no-matches',
    backfillTarget: 200,
    lastFullSyncAt: '2026-08-14T18:00:00Z',
    lastDeltaSyncAt: '2026-08-14T18:00:00Z'
  }
}

/** Listeners registered by the renderer, invoked by the fake sync run below. */
const progressListeners = new Set<(event: SyncProgressEvent) => void>()
const keyInvalidListeners = new Set<() => void>()

/** Drives a believable progress sequence so the progress bar can be designed against motion. */
function runFakeSync(accountId: string): void {
  if (scenario === 'sync-error') {
    setTimeout(() => {
      for (const cb of progressListeners) {
        cb({
          accountId,
          phase: 'error',
          current: 0,
          total: 100,
          message: 'Riot API unreachable',
          trigger: 'manual'
        })
      }
    }, 400)
    return
  }

  let current = 0
  const total = 60
  const tick = setInterval(() => {
    current += 3
    const done = current >= total
    for (const cb of progressListeners) {
      cb({
        accountId,
        phase: done ? 'complete' : 'backfill',
        current: Math.min(current, total),
        total,
        message: done ? undefined : `Fetching match ${current} of ${total}`,
        // The harness exists to design the progress bar against motion, and an
        // auto-triggered sync deliberately renders nothing.
        trigger: 'manual'
      })
    }
    if (done) clearInterval(tick)
  }, 220)
}

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
const MOCK_SERVER_URL = 'https://foxfire.example.com'

let serverState: ServerState =
  scenario === 'server-connected' || scenario === 'server-degraded'
    ? {
        activeUrl: MOCK_SERVER_URL,
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
        riotKeyRejected: scenario === 'server-degraded'
      }
    : scenario === 'server-outdated'
      ? {
          // Signed in, and then the host upgraded their server out from under
          // this build. That is the shape worth designing for: the session is
          // still real, and it is the reads that stop.
          activeUrl: MOCK_SERVER_URL,
          servers: [
            { url: MOCK_SERVER_URL, name: 'The Fox Den', username: 'Faker', isActive: true }
          ],
          session: {
            url: MOCK_SERVER_URL,
            username: 'Faker',
            email: 'faker@example.com',
            isAdmin: false
          },
          upgradeRequired: '0.14.0',
          riotKeyRejected: false
        }
      : { activeUrl: null, servers: [], session: null, upgradeRequired: null,
        riotKeyRejected: false }

const serverListeners = new Set<(state: ServerState) => void>()
const importListeners = new Set<(progress: ImportProgress) => void>()

/**
 * The shared replay library, biggest first — which is the order the panel
 * shows them in, because the reason to open that list is that something needs
 * to go.
 */
const MOCK_STORED_REPLAYS: AdminReplay[] = [
  {
    matchId: 'NA1_5312345678',
    patch: '15.16',
    fileBytes: 34_200_000,
    uploadedBy: 'Faker',
    uploadedAt: '2026-09-16T21:04:00.000Z'
  },
  {
    matchId: 'NA1_5312301111',
    patch: '15.14',
    fileBytes: 29_800_000,
    uploadedBy: 'Sova',
    uploadedAt: '2026-08-30T19:41:00.000Z'
  },
  {
    matchId: 'NA1_5311900042',
    patch: null,
    fileBytes: 21_500_000,
    uploadedBy: null,
    uploadedAt: '2026-07-02T23:12:00.000Z'
  }
]

function setServerState(next: ServerState): ServerState {
  serverState = next
  for (const listener of serverListeners) listener(next)
  return next
}


/**
 * The server this harness pretends to administer.
 *
 * Mutable, so the management page behaves: promote somebody and the badge
 * appears, withdraw an invite and it leaves the list. Reachable under
 * ?scenario=server-connected, whose session is an admin.
 */
let mockUsers: AdminUser[] = [
  {
    id: 'u-1',
    username: 'Faker',
    email: 'faker@example.com',
    isAdmin: true,
    isDisabled: false,
    createdAt: '2026-06-01T10:00:00.000Z',
    linkedRiotAccounts: 2,
    activeSessions: 1
  },
  {
    id: 'u-2',
    username: 'phantomduval',
    email: 'duval@example.com',
    isAdmin: false,
    isDisabled: false,
    createdAt: '2026-07-14T18:30:00.000Z',
    linkedRiotAccounts: 1,
    activeSessions: 2
  },
  {
    id: 'u-3',
    username: 'ward andersen',
    email: 'ward@example.com',
    isAdmin: false,
    isDisabled: true,
    createdAt: '2026-08-02T09:15:00.000Z',
    linkedRiotAccounts: 0,
    activeSessions: 0
  }
]

let mockInvites: AdminInvite[] = [
  {
    id: 'i-1',
    email: 'killua@example.com',
    link: 'https://foxfire.example.com/invite/QbGgAX5_snuoIQKRWXw1EQAAAABqvs9-.K8nkbyg6mVzANgvRHI7L2RS2JaXxPzmf',
    createdAt: '2026-09-10T12:00:00.000Z',
    expiresAt: '2026-09-24T12:00:00.000Z',
    redeemedAt: null,
    redeemedBy: null,
    isOpen: true
  },
  {
    id: 'i-2',
    email: 'duval@example.com',
    link: 'https://foxfire.example.com/invite/spent-token-for-the-harness-only-aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: '2026-07-10T12:00:00.000Z',
    expiresAt: '2026-07-24T12:00:00.000Z',
    redeemedAt: '2026-07-14T18:30:00.000Z',
    redeemedBy: 'phantomduval',
    isOpen: false
  }
]

// Uncapped, which is the default a host has to choose away from.
let mockServerSettings: ServerAdminSettings = {
  publicSignup: true,
  backfillTarget: 200,
  replayByteCap: 0
}

export const mockApi: Api = {
  // The browser harness has no Electron and so no real path for a File.
  pathForFile: () => null,
  app: {
    // The harness has no main process to ask, so this is the browser-only
    // stand-in; the packaged app reads it from app.getVersion().
    // Never held, even in the loading scenario — this is chrome, not data.
    getVersion: (): Promise<string> => delay('0.0.0-dev', 0, false)
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
              compatibility: url.includes('too-old') ? 'unsupported' : 'ok'
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
            upgradeRequired: null,
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
                upgradeRequired: null,
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
          upgradeRequired: null,
        riotKeyRejected: false
        }),
        300,
        false
      ),

    setActive: (url: string | null): Promise<ServerState> =>
      delay(
        setServerState({
          ...serverState,
          activeUrl: url,
          servers: serverState.servers.map((s) => ({ ...s, isActive: s.url === url })),
          upgradeRequired: null,
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
          upgradeRequired: null,
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
    users: (): Promise<AdminUser[]> => delay(mockUsers, 200, false),

    // Numbers a host would actually be looking at: a match history that is
    // nowhere near troubling a 10 GB database, beside replays that are the
    // thing which will fill a volume.
    storage: (): Promise<ServerStorageUsage> =>
      delay(
        {
          replaysConfigured: true,
          replayCount: 46,
          replayBytes: 1_412_000_000,
          replayRecords: 46,
          matches: 4_812,
          matchParticipants: 48_120,
          riotAccounts: 7,
          unclaimedAccounts: 2,
          rankReadings: 1_904
        },
        220
      ),

    storedReplays: (): Promise<AdminReplay[]> => delay(MOCK_STORED_REPLAYS, 240),

    removeReplay: (matchId: string): Promise<AdminActionResult> => {
      const index = MOCK_STORED_REPLAYS.findIndex((r) => r.matchId === matchId)
      if (index >= 0) MOCK_STORED_REPLAYS.splice(index, 1)
      return delay({ ok: true, error: null }, 200, false)
    },

    // Actually clears the claim, so the harness shows what the panel does
    // rather than only that it asked. The account and its games stay; that is
    // the whole distinction the card exists to make.
    forceUnlink: (riotAccountId: string): Promise<AdminActionResult> => {
      const account = ACCOUNTS.find((a) => a.id === riotAccountId)
      if (account) {
        account.ownerUsername = null
        account.isMine = false
      }
      return delay({ ok: true, error: null }, 200, false)
    },

    // The harness has no file system and no server, so the import is the one
    // shape the panel has to draw for real: a run that reports its way through
    // the phases and finishes with a tally.
    chooseDatabase: (): Promise<string | null> => delay('C:\\Users\\you\\stats.db', 400, false),

    importDatabase: async (): Promise<ImportResult> => {
      for (const [phase, total] of [['accounts', 3], ['matches', 412], ['readings', 190]] as const) {
        for (const current of [0, total / 2, total]) {
          importListeners.forEach((cb) => cb({ phase, current: Math.round(current), total }))
          await new Promise((resolve) => setTimeout(resolve, 120))
        }
      }

      importListeners.forEach((cb) => cb({ phase: 'finishing', current: 0, total: 0 }))
      await new Promise((resolve) => setTimeout(resolve, 400))
      importListeners.forEach((cb) => cb({ phase: 'done', current: 0, total: 0 }))

      return {
        ok: true,
        message: null,
        accounts: 3,
        matches: 412,
        readings: 190,
        seasons: 1,
        attributed: 88,
        unresolved: ['OldName#NA1']
      }
    },

    onImportProgress: (cb: (progress: ImportProgress) => void): (() => void) => {
      importListeners.add(cb)
      return () => importListeners.delete(cb)
    },

    updateUser: (id: string, patch: AdminUserPatch): Promise<AdminActionResult> => {
      const target = mockUsers.find((u) => u.id === id)
      const admins = mockUsers.filter((u) => u.isAdmin)

      // The same refusal the server makes, so the harness shows the message
      // rather than letting the page reach a state the real thing forbids.
      if (target?.isAdmin && admins.length === 1 && (patch.isAdmin === false || patch.isDisabled)) {
        return delay(
          {
            ok: false,
            error:
              'That is the only administrator on this server, so there is no way to change them from here. Make somebody else an admin first.'
          },
          200,
          false
        )
      }

      mockUsers = mockUsers.map((u) => (u.id === id ? { ...u, ...patch } : u))
      return delay({ ok: true, error: null }, 200, false)
    },

    deleteUser: (id: string): Promise<AdminActionResult> => {
      const target = mockUsers.find((u) => u.id === id)
      if (target?.isAdmin && mockUsers.filter((u) => u.isAdmin).length === 1) {
        return delay(
          {
            ok: false,
            error:
              'That is the only administrator on this server, so there is no way to remove them from here. Make somebody else an admin first.'
          },
          200,
          false
        )
      }

      mockUsers = mockUsers.filter((u) => u.id !== id)
      return delay({ ok: true, error: null }, 200, false)
    },

    invites: (): Promise<AdminInvite[]> => delay(mockInvites, 200, false),

    createInvite: (email: string): Promise<AdminInvite> => {
      const existing = mockInvites.find((i) => i.email === email && i.isOpen)
      if (existing) return delay(existing, 300, false)

      const invite: AdminInvite = {
        id: `i-${mockInvites.length + 1}`,
        email,
        link: `https://foxfire.example.com/invite/${btoa(email).replace(/=/g, "")}-harness-token-aaaaaaaaaaaa`,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
        redeemedAt: null,
        redeemedBy: null,
        isOpen: true
      }

      mockInvites = [invite, ...mockInvites]
      return delay(invite, 300, false)
    },

    revokeInvite: (id: string): Promise<AdminActionResult> => {
      mockInvites = mockInvites.filter((i) => i.id !== id)
      return delay({ ok: true, error: null }, 200, false)
    },

    getSettings: (): Promise<ServerAdminSettings> => delay(mockServerSettings, 180, false),

    setSettings: (patch: Partial<ServerAdminSettings>): Promise<ServerAdminSettings> => {
      mockServerSettings = { ...mockServerSettings, ...patch }
      return delay(mockServerSettings, 180, false)
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
    list: (): Promise<Account[]> => delay(accounts(), 180, false),
    getHome: (): Promise<Account | null> => delay(accounts()[0] ?? null, 180, false),
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
    remove: (accountId: string): Promise<Account[]> =>
      delay(accounts().filter((a) => a.id !== accountId)),
    setHome: (accountId: string): Promise<Account[]> =>
      delay(accounts().map((a) => ({ ...a, isHomeAccount: a.id === accountId })))
  },

  dashboard: {
    get: (accountId: string): Promise<DashboardData | null> => {
      if (scenario === 'key-expired') return fail(KEY_EXPIRED)
      const account = accounts().find((a) => a.id === accountId)
      if (!account) return delay(null)
      return delay({
        account,
        leagueEntries: LEAGUE_ENTRIES[accountId] ?? [],
        syncState: syncState(accountId)
      })
    },
    matchList: (
      accountId: string,
      limit: number,
      offset: number,
      queueId: number | null
    ): Promise<MatchSummary[]> => {
      // Filter before slicing, mirroring the real handler's SQL — otherwise the
      // harness pages differently to the app and hides paging bugs.
      const all = matchesFor(accountId).filter((m) => queueId === null || m.queueId === queueId)
      return delay(all.slice(offset, offset + limit), 260)
    },
    matchDetail: (matchId: string): Promise<MatchDetail | null> =>
      delay(MATCH_DETAILS[matchId] ?? null, 420)
  },

  sync: {
    start: (accountId: string): Promise<void> => {
      runFakeSync(accountId)
      return delay(undefined, 100)
    },
    getState: (accountId: string): Promise<SyncState | null> => delay(syncState(accountId)),
    onProgress: (cb) => {
      progressListeners.add(cb)
      return () => progressListeners.delete(cb)
    }
  },

  assets: {
    // Real Data Dragon metadata, so champion, item, spell and rune art all load
    // from the CDN exactly as it does in the app.
    get: (): Promise<AssetManifest> => delay(DDRAGON_MANIFEST, 60, false)
  },

  liveClient: {
    // Answered fast and without the shell hold, because the real one polls: a
    // held promise under ?scenario=loading would stall every tick behind it.
    scoreboard: (): Promise<Scoreboard | null> =>
      scenario === 'not-live' ? delay(null, 200, false) : delay(SCOREBOARD, 200, false)
  },

  champions: {
    stats: (
      accountId: string,
      queueId: number | null,
      range: RankRange
    ): Promise<ChampionStats[]> => delay(championStatsFor(accountId, queueId, range), 300)
  },

  // Editable in the harness so the Settings form can be designed against it,
  // but held in memory: DEV_SEASONS is what every other mock reads, and
  // rewriting it at runtime would desync the already-stamped fixture
  // snapshots from the list the pickers are built from.
  seasons: {
    list: (): Promise<Season[]> => delay(DEV_SEASONS, 120),
    save: (seasons: SeasonInput[]): Promise<Season[]> =>
      delay(
        seasons.map((s, i) => ({ ...s, id: s.id ?? 1000 + i })),
        200
      )
  },

  mastery: {
    get: (accountId: string, _refresh: boolean, queueId: number | null): Promise<MasteryData> =>
      delay(
        {
          // Mastery is lifetime and never narrows; only the win rates do.
          riotMastery: MASTERY[accountId] ?? [],
          localWinRates: championStatsFor(accountId, queueId)
        },
        300
      )
  },

  rank: {
    history: (accountId: string, queueType: QueueType, range: RankRange): Promise<RankHistory> => {
      const { sinceMs, untilMs } = rangeBounds(range, DEV_SEASONS)
      const snapshots = (RANK_SNAPSHOTS[accountId]?.[queueType] ?? []).filter(
        (s) =>
          (sinceMs === null || s.capturedAt >= sinceMs) &&
          (untilMs === null || s.capturedAt < untilMs)
      )

      const milestones = snapshots
        .flatMap((snapshot, i) => {
          if (i === 0) return []
          // Mirrors getRankMilestones: a reset is not a demotion. Keyed on the
          // reset rather than the season boundary, so a promotion across a
          // preseason — which carries rank forward — still counts.
          if (resetsBetween(DEV_SEASONS, snapshots[i - 1].capturedAt, snapshot.capturedAt)) {
            return []
          }
          const movement = rankMovement(snapshots[i - 1], snapshot)
          if (movement === 'none') return []
          return [
            {
              queueType,
              movement,
              tier: snapshot.tier,
              rank: snapshot.rank,
              capturedAt: snapshot.capturedAt
            }
          ]
        })
        .reverse()

      return delay({ snapshots, milestones }, 280)
    },

    periods: (accountId: string): Promise<Season[]> => {
      const times = [
        ...Object.values(RANK_SNAPSHOTS[accountId] ?? {}).flatMap((series) =>
          series.map((s) => s.capturedAt)
        ),
        ...(MATCHES[accountId] ?? []).map((m) => m.gameCreation)
      ]
      if (times.length === 0) return delay(DEV_SEASONS.slice(-1), 120)
      return delay(seasonsSpanning(DEV_SEASONS, Math.min(...times), Math.max(...times)), 120)
    },

    editable: (accountId: string, queueType: QueueType) =>
      delay(editableMatches(accountId, queueType), 200),

    saveManual: (accountId: string, queueType: QueueType, edits) => {
      const fresh = saveManualRanks(accountId, queueType, edits)
      notifyEdited(accountId)
      return delay(fresh, 250)
    },

    clearManual: (accountId: string, queueType: QueueType, matchId: string) => {
      const fresh = clearManualRank(accountId, queueType, matchId)
      notifyEdited(accountId)
      return delay(fresh, 250)
    },

    // There are no windows in a browser, so the editor takes over the page
    // instead. main.tsx picks its root from the hash at startup, so setting it
    // and reloading lands on the editor exactly as the real window does.
    openEditor: (accountId: string, queueType: QueueType, matchId: string): Promise<void> => {
      window.location.hash = `#lp-editor?account=${accountId}&queue=${queueType}&match=${encodeURIComponent(matchId)}`
      window.location.reload()
      return Promise.resolve()
    },

    onEdited: (cb) => {
      editedListeners.add(cb)
      return () => editedListeners.delete(cb)
    },
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
              // A game in progress in the default scenario, so the Live tab's
              // indicator has something to show without a client running.
              inGame: true
            },
        100
      ),
    onStatus: () => () => {},
    onRankChanged: () => () => {}
  },

  background: {
    get: (): Promise<BackgroundSettings> =>
      delay({ runInTray: false, launchAtStartup: false, lcuInstallPath: null }, 100),
    set: (patch): Promise<BackgroundSettings> =>
      delay({ runInTray: false, launchAtStartup: false, lcuInstallPath: null, ...patch }, 150)
  },

  search: {
    summoner: (input): Promise<AdHocSummonerResult> => {
      if (input.gameName.toLowerCase() === 'nobody') {
        return fail('No summoner found with that Riot ID.')
      }
      return delay(
        {
          profile: {
            puuid: 'puuid-searched',
            gameName: input.gameName,
            tagLine: input.tagLine,
            profileIconId: 5788,
            summonerLevel: 214
          },
          leagueEntries: LEAGUE_ENTRIES[2],
          recentMatches: MATCHES[2].slice(0, 10)
        },
        900
      )
    }
  },
  /**
   * The panel opens at `#telemetry` in its own window against the real main
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
    onShowMatch: () => () => undefined
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

  // A live-game fan-out: ten rank lookups issued at once, queued serially.
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
