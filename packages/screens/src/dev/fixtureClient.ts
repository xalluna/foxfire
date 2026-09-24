import type {
  Account,
  AdminActionResult,
  AdminInvite,
  AdminPasswordReset,
  AdminReplay,
  AdminUser,
  AdminUserPatch,
  AdminUserQuery,
  AssetManifest,
  AttachRecordingInput,
  AttachRecordingOutcome,
  ChampionStats,
  ConnectionState,
  DashboardData,
  FavoritePlayer,
  FoxfireClient,
  ImportProgress,
  ImportResult,
  MasteryData,
  MatchDetail,
  MatchRecording,
  MatchSummary,
  Page,
  PageOptions,
  PlayerSearchResult,
  QueueType,
  RankHistory,
  RankRange,
  RankTrend,
  Season,
  SeasonInput,
  ServerAdminSettings,
  ServerStorageUsage,
  SyncProgressEvent,
  SyncState
} from '@foxfire/core'
import {
  compareSearchResults,
  pageOf,
  rankMovement,
  rankTrend,
  rangeBounds,
  resetsBetween,
  searchRank,
  seasonsSpanning,
  serializeFavorites
} from '@foxfire/core'
import { favoritesOver } from '@foxfire/core/server'
import { isPlayer } from '@foxfire/core/routes'
import { DEV_SEASONS } from './seasons'
import { DDRAGON_MANIFEST } from './ddragonManifest'
import {
  ACCOUNTS,
  COMMUNITY,
  LEAGUE_ENTRIES,
  MASTERY,
  MATCHES,
  MATCH_DETAILS,
  MATCH_RECORDINGS,
  RANK_SNAPSHOTS,
  championStatsFor
} from './fixtures'
import { clearManualRank, editableMatches, saveManualRanks } from './manualRank'
import { KEY_EXPIRED, MOCK_SERVER_URL, delay, fail, scenario } from './scenario'

/**
 * A FoxfireClient made of fixtures, for reviewing every screen in a browser.
 *
 * The real clients need a live Riot key that expires daily and a synced
 * database — or a server — before they show anything; this renders every
 * screen and every state instantly and deterministically. Typed as the same
 * interface the real ones implement, so the compiler catches any drift between
 * the harness and the contract.
 *
 * One instance per page: its listeners and its edits are module state, so
 * promoting somebody or entering LP sticks for the session, the way it would
 * against a real server.
 *
 * Dev-only — each app imports @foxfire/screens/dev lazily behind
 * import.meta.env.DEV, so none of this reaches a production build.
 */

/** Listeners registered by the screens, invoked by the fake sync run and the edits below. */
const progressListeners = new Set<(event: SyncProgressEvent) => void>()
const editedListeners = new Set<(accountId: string) => void>()
const rankChangedListeners = new Set<(accountId: string) => void>()
const connectionListeners = new Set<(state: ConnectionState) => void>()
const recordingListeners = new Set<(event: { accountId: string; matchId: string }) => void>()

/**
 * What the harness's server holds on YouTube, as it changes this session.
 *
 * Keyed `account:match` because a recording is one player's view of a game —
 * the same match under the other account is a different key with, here,
 * nothing in it.
 */
const recordings = new Map<string, MatchRecording>(Object.entries(MATCH_RECORDINGS))
const recordingKey = (accountId: string, matchId: string): string => `${accountId}:${matchId}`

function notifyRecording(accountId: string, matchId: string): void {
  for (const listener of recordingListeners) listener({ accountId, matchId })
}

/** A row as the server sends it: with this account's recording of the game, or none. */
function withRecording(accountId: string, match: MatchSummary): MatchSummary {
  const recording = recordings.get(recordingKey(accountId, match.matchId))
  return {
    ...match,
    recording: recording
      ? { youtubeVideoId: recording.youtubeVideoId, privacy: recording.privacy, hasEvents: recording.hasEvents }
      : null
  }
}

function notifyEdited(accountId: string): void {
  for (const listener of editedListeners) listener(accountId)
}

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

/**
 * Where the harness says its data comes from.
 *
 * Local-only by default, which is the desktop's ordinary state. The server
 * scenarios are the connected shapes: an admin on a healthy server, a server
 * whose own Riot key has expired, and a server that has been upgraded past
 * this client.
 */
const connection: ConnectionState =
  scenario === 'server-connected' || scenario === 'server-degraded'
    ? {
        mode: 'server',
        publicUrl: MOCK_SERVER_URL,
        serverName: 'The Fox Den',
        session: { username: 'Faker', email: 'faker@example.com', isAdmin: true },
        riotKeyRejected: scenario === 'server-degraded',
        upgradeRequired: null
      }
    : scenario === 'server-outdated'
      ? {
          mode: 'server',
          publicUrl: MOCK_SERVER_URL,
          serverName: 'The Fox Den',
          session: { username: 'Faker', email: 'faker@example.com', isAdmin: false },
          riotKeyRejected: false,
          upgradeRequired: '0.14.0'
        }
      : {
          mode: 'local',
          publicUrl: null,
          serverName: null,
          session: null,
          riotKeyRejected: false,
          upgradeRequired: null
        }

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
  },
  // A long-running community's worth behind those, all smaller, so the library
  // has pages to show more of. Generated from the index — the same every load.
  ...Array.from({ length: 117 }, (_, i): AdminReplay => ({
    matchId: `NA1_52${String(9_000_000 - i * 7919).padStart(8, '0')}`,
    patch: ['15.16', '15.15', '15.14', '15.13'][i % 4],
    fileBytes: 21_000_000 - i * 97_000,
    uploadedBy: ['Faker', 'Sova', null, 'phantomduval'][i % 4],
    uploadedAt: new Date(Date.UTC(2026, 6, 1) - i * 86_400_000).toISOString()
  }))
]

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
    activeSessions: 1,
    passwordReset: null
  },
  {
    id: 'u-2',
    username: 'phantomduval',
    email: 'duval@example.com',
    isAdmin: false,
    isDisabled: false,
    createdAt: '2026-07-14T18:30:00.000Z',
    linkedRiotAccounts: 1,
    activeSessions: 2,
    // One member arrives with a link outstanding, so the harness shows the
    // panel without anybody having to make one first.
    passwordReset: {
      id: 'r-1',
      userId: 'u-2',
      link: 'https://foxfire.example.com/reset-password/SGVsbG9SZXNldExpbmtGb3JIYXJuZXNz.dGhpc2lzbm90YXJlYWxzaWduYXR1cmU',
      createdAt: '2026-09-21T20:00:00.000Z',
      expiresAt: '2026-09-22T20:00:00.000Z'
    }
  },
  {
    id: 'u-3',
    username: 'ward andersen',
    email: 'ward@example.com',
    isAdmin: false,
    isDisabled: true,
    createdAt: '2026-08-02T09:15:00.000Z',
    linkedRiotAccounts: 0,
    activeSessions: 0,
    passwordReset: null
  },
  // Enough more that the page has pages: 120 people, in three of them.
  ...Array.from({ length: 117 }, (_, i): AdminUser => {
    const n = String(i + 1).padStart(3, '0')
    return {
      id: `u-gen-${n}`,
      username: `Summoner${n}`,
      email: `summoner${n}@example.net`,
      isAdmin: false,
      isDisabled: i % 23 === 0,
      createdAt: new Date(Date.UTC(2026, 5, 1) + i * 3_600_000 * 11).toISOString(),
      linkedRiotAccounts: i % 3,
      activeSessions: i % 4 === 0 ? 0 : 1,
      passwordReset: null
    }
  })
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
  },
  {
    id: 'i-3',
    email: 'gon@example.com',
    link: 'https://foxfire.example.com/invite/open-token-for-the-harness-only-bbbbbbbbbbbbbbbbbbbbbbbbbbb',
    createdAt: '2026-09-18T09:00:00.000Z',
    expiresAt: '2026-10-02T09:00:00.000Z',
    redeemedAt: null,
    redeemedBy: null,
    isOpen: true
  },
  {
    id: 'i-4',
    email: 'kurapika@example.com',
    link: 'https://foxfire.example.com/invite/open-token-for-the-harness-only-ccccccccccccccccccccccccccc',
    createdAt: '2026-09-20T15:30:00.000Z',
    expiresAt: '2026-10-04T15:30:00.000Z',
    redeemedAt: null,
    redeemedBy: null,
    isOpen: true
  },
  // Lapsed without being used. The server keeps it and sends it nowhere, so
  // neither list should show it.
  {
    id: 'i-5',
    email: 'lapsed@example.com',
    link: 'https://foxfire.example.com/invite/lapsed-token-for-the-harness-only-dddddddddddddddddddddddd',
    createdAt: '2026-08-01T12:00:00.000Z',
    expiresAt: '2026-08-15T12:00:00.000Z',
    redeemedAt: null,
    redeemedBy: null,
    isOpen: false
  },
  // Everybody else who joined by invitation, so the used list has pages.
  ...Array.from({ length: 72 }, (_, i): AdminInvite => {
    const n = String(i + 1).padStart(3, '0')
    const created = Date.UTC(2026, 6, 1) - i * 2 * 86_400_000
    return {
      id: `i-gen-${n}`,
      email: `summoner${n}@example.net`,
      link: `https://foxfire.example.com/invite/used-token-${n}-for-the-harness-only-eeeeeeeeeeeeeeeeeeeeee`,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + 14 * 86_400_000).toISOString(),
      redeemedAt: new Date(created + 86_400_000).toISOString(),
      redeemedBy: i % 17 === 0 ? null : `Summoner${n}`,
      isOpen: false
    }
  })
]

/** A member matches a search the way the server matches one: part of the name or the address, any case. */
function isMemberMatch(user: AdminUser, needle: string): boolean {
  return user.username.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
}

// Uncapped, which is the default a host has to choose away from.
let mockServerSettings: ServerAdminSettings = {
  publicSignup: true,
  backfillTarget: 200,
  replayByteCap: 0
}

export interface FixtureClientOptions {
  /**
   * Every fixture account as the one asking sees it. The desktop's harness
   * makes some of them somebody else's while it plays at being on a server.
   */
  describe?: (account: Account) => Account
  /**
   * Whether everybody else on the harness's server is there to be found. Not
   * on a desktop playing at being local-only, whose database has nobody but
   * its own accounts. Always, when left out.
   */
  community?: () => boolean
}

/**
 * The players starred when a harness opens: one whose copy is current, and
 * one seen weeks ago, since promoted — so opening their profile, or finding
 * them in the box, shows the copy catching up.
 */
function seededFavorites(): string {
  const [fakest, tidecaller] = [COMMUNITY[1], COMMUNITY[8]]
  const favorites: FavoritePlayer[] = [
    {
      account: tidecaller,
      soloEntry: LEAGUE_ENTRIES[tidecaller.id]?.[0] ?? null,
      addedAt: '2026-09-20T10:00:00Z'
    },
    {
      account: { ...fakest, summonerLevel: 118, updatedAt: '2026-08-01T10:00:00Z' },
      soloEntry: {
        queueType: 'RANKED_SOLO_5x5',
        tier: 'PLATINUM',
        rank: 'I',
        leaguePoints: 77,
        wins: 31,
        losses: 30,
        fetchedAt: '2026-08-01T10:00:00Z'
      },
      addedAt: '2026-09-10T10:00:00Z'
    }
  ]
  return serializeFavorites(favorites)
}

export function createFixtureClient(options: FixtureClientOptions = {}): FoxfireClient {
  const describe = options.describe ?? ((account: Account) => account)
  const community = options.community ?? (() => true)
  const everyone = (): Account[] => [...accounts(), ...(community() ? COMMUNITY : [])].map(describe)

  // Kept the way a browser keeps them, for as long as the page is open.
  let starred: string | null = seededFavorites()
  const favorites = favoritesOver({ get: () => starred, set: (list) => (starred = list) })

  // The home this harness remembers, as a browser or a PC would. Null opens on
  // your first account.
  let homeId: string | null = null

  const mine = (): Account[] => {
    const own = everyone().filter((a) => a.isMine !== false)
    const home = homeId === null ? own[0] : own.find((a) => a.id === homeId)
    return own.map((a) => ({ ...a, isHomeAccount: a.id === home?.id }))
  }

  return {
    connection: {
      get: (): Promise<ConnectionState> => delay(connection, 120, false),
      onChanged: (cb) => {
        connectionListeners.add(cb)
        return () => connectionListeners.delete(cb)
      }
    },

    accounts: {
      mine: (): Promise<Account[]> => delay(mine(), 180, false),
      get: (accountId: string): Promise<Account | null> =>
        delay(everyone().find((a) => a.id === accountId) ?? null, 120, false),
      find: (riotId): Promise<Account | null> =>
        delay(everyone().find((a) => isPlayer(a, riotId)) ?? null, 120, false),
      getHome: (): Promise<Account | null> => {
        const home = (homeId === null ? undefined : everyone().find((a) => a.id === homeId)) ?? mine()[0]
        return delay(home ? { ...home, isHomeAccount: true } : null, 180, false)
      },
      remove: (accountId: string): Promise<Account[]> => delay(mine().filter((a) => a.id !== accountId)),
      setHome: (accountId: string): Promise<Account[]> => {
        homeId = accountId
        return delay(mine())
      }
    },

    dashboard: {
      get: (accountId: string): Promise<DashboardData | null> => {
        if (scenario === 'key-expired') return fail(KEY_EXPIRED)
        const account = everyone().find((a) => a.id === accountId)
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
      ): Promise<Page<MatchSummary>> => {
        // Filter before slicing, mirroring the real handler's SQL — otherwise the
        // harness pages differently to the app and hides paging bugs.
        const all = matchesFor(accountId).filter((m) => queueId === null || m.queueId === queueId)
        const page = pageOf(all, { limit, offset })
        return delay({ ...page, items: page.items.map((m) => withRecording(accountId, m)) }, 260)
      },
      matchDetail: (matchId: string): Promise<MatchDetail | null> =>
        delay(MATCH_DETAILS[matchId] ?? null, 420),
      matchSummary: (accountId: string, matchId: string): Promise<MatchSummary | null> => {
        const match = matchesFor(accountId).find((m) => m.matchId === matchId)
        return delay(match ? withRecording(accountId, match) : null, 200)
      }
    },

    matchRecordings: {
      get: (accountId: string, matchId: string): Promise<MatchRecording | null> =>
        delay(recordings.get(recordingKey(accountId, matchId)) ?? null, 220),

      // The server's rules, so the harness refuses what it would: only the
      // account's owner attaches, and a second one asks first.
      attach: (accountId: string, matchId: string, input: AttachRecordingInput): Promise<AttachRecordingOutcome> => {
        const account = everyone().find((a) => a.id === accountId)
        if (account?.isMine === false) {
          return delay({ ok: false, reason: 'failed', message: 'That League account is not linked to your Foxfire account.' }, 300)
        }

        const key = recordingKey(accountId, matchId)
        const existing = recordings.get(key)
        if (existing && !input.replace) {
          return delay(
            {
              ok: false,
              reason: 'exists',
              message: existing.title
                ? `This game already has a recording attached: “${existing.title}”.`
                : 'This game already has a recording attached.'
            },
            300
          )
        }

        recordings.set(key, {
          youtubeVideoId: input.youtubeVideoId,
          privacy: input.privacy ?? null,
          hasEvents: input.events !== undefined,
          title: input.title ?? null,
          durationSeconds: input.durationSeconds ?? null,
          source: input.source,
          attachedBy: 'Faker',
          attachedAt: new Date().toISOString(),
          events: input.events ?? []
        })
        notifyRecording(accountId, matchId)
        return delay({ ok: true }, 300)
      },

      detach: (accountId: string, matchId: string): Promise<AdminActionResult> => {
        const removed = recordings.delete(recordingKey(accountId, matchId))
        if (removed) notifyRecording(accountId, matchId)
        return delay({ ok: removed, error: removed ? null : 'There is no recording on that game.' }, 250)
      }
    },

    sync: {
      start: (accountId: string): Promise<void> => {
        runFakeSync(accountId)
        return delay(undefined, 100)
      },
      getState: (accountId: string): Promise<SyncState | null> => delay(syncState(accountId))
    },

    assets: {
      // Real Data Dragon metadata, so champion, item, spell and rune art all load
      // from the CDN exactly as it does in the app.
      get: (): Promise<AssetManifest> => delay(DDRAGON_MANIFEST, 60, false)
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
        const series = RANK_SNAPSHOTS[accountId]?.[queueType] ?? []
        const snapshots = series.filter(
          (s) =>
            (sinceMs === null || s.capturedAt >= sinceMs) &&
            (untilMs === null || s.capturedAt < untilMs)
        )
        const before =
          sinceMs === null ? null : (series.filter((s) => s.capturedAt < sinceMs).at(-1) ?? null)

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

        return delay({ snapshots, milestones, before }, 280)
      },

      // The whole series is handed over: the rule only looks backwards from
      // each day, so it reads the same carry-in a server's two queries would.
      // Read at call time, so LP typed into the harness's editor shows here.
      trend: (accountId: string, queueType: QueueType): Promise<RankTrend> =>
        delay(rankTrend(RANK_SNAPSHOTS[accountId]?.[queueType] ?? [], DEV_SEASONS, Date.now()), 220),

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
      }
    },

    search: {
      // The same matching, ranking, filters and paging the server applies, so
      // the harness answers a half-typed name the way a real one does.
      players: (query: string, options = {}): Promise<Page<PlayerSearchResult>> => {

        const matches = everyone()
          .filter((account) => searchRank(account, query) !== null)
          .filter((account) => !options.mine || account.isMine !== false)
          .filter((account) => !options.claimed || account.ownerUsername != null)
          .sort(compareSearchResults(query))

        const page = pageOf(matches, options)

        return delay(
          {
            total: page.total,
            items: page.items.map((account) => ({
              account,
              soloEntry:
                (LEAGUE_ENTRIES[account.id] ?? []).find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? null
            }))
          },
          200
        )
      }
    },

    favorites,

    admin: {
      users: (query: AdminUserQuery = {}): Promise<Page<AdminUser>> => {
        const needle = (query.q ?? '').trim().toLowerCase()
        const matching = mockUsers
          .filter((user) => needle.length === 0 || isMemberMatch(user, needle))
          .sort((a, b) => a.username.localeCompare(b.username))

        return delay(pageOf(matching, query), 200, false)
      },

      // Numbers a host would actually be looking at: a match history that is
      // nowhere near troubling a 10 GB database, beside replays that are the
      // thing which will fill a volume.
      storage: (): Promise<ServerStorageUsage> =>
        delay(
          {
            replaysConfigured: true,
            replayCount: MOCK_STORED_REPLAYS.length,
            replayBytes: MOCK_STORED_REPLAYS.reduce((total, replay) => total + (replay.fileBytes ?? 0), 0),
            replayRecords: MOCK_STORED_REPLAYS.length,
            matches: 4_812,
            matchParticipants: 48_120,
            riotAccounts: 7,
            unclaimedAccounts: 2,
            rankReadings: 1_904
          },
          220
        ),

      storedReplays: (page?: PageOptions): Promise<Page<AdminReplay>> =>
        delay(pageOf(MOCK_STORED_REPLAYS, page), 240),

      removeReplay: (matchId: string): Promise<AdminActionResult> => {
        const index = MOCK_STORED_REPLAYS.findIndex((r) => r.matchId === matchId)
        if (index >= 0) MOCK_STORED_REPLAYS.splice(index, 1)
        return delay({ ok: true, error: null }, 200, false)
      },

      // Actually clears the claim, so the harness shows what the panel does
      // rather than only that it asked. The account and its games stay; that is
      // the whole distinction the card exists to make.
      forceUnlink: (riotAccountId: string): Promise<AdminActionResult> => {
        const account = [...ACCOUNTS, ...COMMUNITY].find((a) => a.id === riotAccountId)
        if (account) {
          account.ownerUsername = null
          account.isMine = false
        }
        return delay({ ok: true, error: null }, 200, false)
      },

      // Actually appends, so the harness shows the account turning up unclaimed
      // in the finder afterwards rather than only that the form submitted.
      addRiotAccount: (input): Promise<Account> => {
        const gameName = input.gameName.trim()
        const tagLine = input.tagLine.replace(/^#/, '').trim()

        if (gameName.toLowerCase() === 'nobody') {
          return fail(`Riot has no account called ${gameName}#${tagLine} in this region.`)
        }

        const existing = ACCOUNTS.find(
          (a) => a.gameName.toLowerCase() === gameName.toLowerCase() && a.tagLine.toLowerCase() === tagLine.toLowerCase()
        )
        if (existing) return fail(`This server already tracks ${existing.gameName}#${existing.tagLine}.`)

        const account: Account = {
          id: `added-${ACCOUNTS.length + 1}`,
          puuid: `puuid-${gameName.toLowerCase()}`,
          gameName,
          tagLine,
          platform: 'na1',
          regionalRoute: 'americas',
          summonerId: null,
          profileIconId: 5788,
          summonerLevel: 214,
          isHomeAccount: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isMine: false,
          ownerUsername: null
        }

        ACCOUNTS.push(account)
        return delay(account, 400, false)
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

      createPasswordReset: (userId: string): Promise<AdminPasswordReset> => {
        const user = mockUsers.find((u) => u.id === userId)

        if (user?.isDisabled) {
          return Promise.reject(
            new Error(`${user.username} is disabled, so a reset link would not get them in. Enable them first.`)
          )
        }

        const reset: AdminPasswordReset = {
          id: `r-${Date.now()}`,
          userId,
          link: `https://foxfire.example.com/reset-password/${btoa(userId).replace(/=/g, '')}-harness-token.aaaaaaaaaaaa`,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString()
        }

        // A newer link replaces whatever was outstanding, the way the server
        // does it — there is never more than one live per account.
        mockUsers = mockUsers.map((u) => (u.id === userId ? { ...u, passwordReset: reset } : u))
        return delay(reset, 300, false)
      },

      revokePasswordReset: (userId: string): Promise<AdminActionResult> => {
        mockUsers = mockUsers.map((u) => (u.id === userId ? { ...u, passwordReset: null } : u))
        return delay({ ok: true, error: null }, 200, false)
      },

      // Open and used apart, as the server sends them; the lapsed one is in
      // neither, as the server's is not.
      openInvites: (): Promise<AdminInvite[]> =>
        delay(
          mockInvites.filter((i) => i.isOpen).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          200,
          false
        ),

      usedInvites: (page?: PageOptions): Promise<Page<AdminInvite>> =>
        delay(
          pageOf(
            mockInvites
              .filter((i) => i.redeemedAt !== null)
              .sort((a, b) => (b.redeemedAt ?? '').localeCompare(a.redeemedAt ?? '')),
            page
          ),
          200,
          false
        ),

      createInvite: (email: string): Promise<AdminInvite> => {
        const existing = mockInvites.find((i) => i.email === email && i.isOpen)
        if (existing) return delay(existing, 300, false)

        const invite: AdminInvite = {
          id: `i-${mockInvites.length + 1}`,
          email,
          link: `https://foxfire.example.com/invite/${btoa(email).replace(/=/g, '')}-harness-token-aaaaaaaaaaaa`,
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

    events: {
      onSyncProgress: (cb) => {
        progressListeners.add(cb)
        return () => progressListeners.delete(cb)
      },
      onRankEdited: (cb) => {
        editedListeners.add(cb)
        return () => editedListeners.delete(cb)
      },
      // Nothing in a browser reads a League client, so nothing ever fires this.
      onRankChanged: (cb) => {
        rankChangedListeners.add(cb)
        return () => rankChangedListeners.delete(cb)
      },
      onRecordingChanged: (cb) => {
        recordingListeners.add(cb)
        return () => recordingListeners.delete(cb)
      }
    }
  }
}

/** How many times the harness's import has run, so each run can be a different outcome. */
let fixtureImportRuns = 0

/**
 * A stats.db import that reports its way through the phases and finishes with
 * a tally.
 *
 * The harness has no file system and no server, so this is the one shape the
 * panel has to draw for real. Either platform's harness can hand it to the
 * Data & storage page.
 *
 * Each run is a different outcome, in turn, so all of them can be looked at by
 * pressing the button: the first import of a file, the same file again three
 * days later (mostly already there, some new, a few problems), and the same
 * file again with nothing new in it.
 */
export async function runFixtureImport(
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const outcome = FIXTURE_IMPORTS[fixtureImportRuns++ % FIXTURE_IMPORTS.length]

  for (const [phase, total] of [
    ['accounts', 3],
    ['comparing', outcome.total],
    ['matches', outcome.matches],
    ['readings', outcome.readings]
  ] as const) {
    for (const current of [0, total / 2, total]) {
      onProgress({ phase, current: Math.round(current), total })
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }

  onProgress({ phase: 'finishing', current: 0, total: 0 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  onProgress({ phase: 'done', current: 0, total: 0 })

  return outcome.result
}

const DAY = 86_400_000

const FIXTURE_IMPORTS: Array<{
  /** Games in the file. */
  total: number
  /** Payloads actually sent. */
  matches: number
  readings: number
  result: ImportResult
}> = [
  {
    total: 412,
    matches: 412,
    readings: 190,
    result: {
      ok: true,
      message: null,
      accounts: 3,
      matches: 412,
      readings: 190,
      seasons: 1,
      attributed: 88,
      unresolved: ['OldName#NA1'],
      alreadyThere: { matches: 0, readings: 0, seasons: 0 },
      matchesFailed: 0,
      readingsUnplaced: 0,
      healed: 0,
      newest: { matchAt: Date.now() - 4 * DAY, readingAt: Date.now() - 4 * DAY }
    }
  },
  {
    total: 431,
    matches: 19,
    readings: 190,
    result: {
      ok: true,
      message: null,
      accounts: 3,
      matches: 17,
      readings: 24,
      seasons: 0,
      attributed: 17,
      unresolved: [],
      alreadyThere: { matches: 412, readings: 166, seasons: 1 },
      matchesFailed: 2,
      readingsUnplaced: 5,
      healed: 6,
      newest: { matchAt: Date.now() - 3_600_000, readingAt: Date.now() - 3_000_000 }
    }
  },
  {
    total: 431,
    matches: 0,
    readings: 190,
    result: {
      ok: true,
      message: null,
      accounts: 3,
      matches: 0,
      readings: 0,
      seasons: 0,
      attributed: 0,
      unresolved: [],
      alreadyThere: { matches: 431, readings: 190, seasons: 1 },
      matchesFailed: 0,
      readingsUnplaced: 0,
      healed: 0,
      // Stops where the last copy did — what a file read without its
      // write-ahead log looks like.
      newest: { matchAt: Date.now() - 3 * DAY, readingAt: Date.now() - 3 * DAY }
    }
  }
]
