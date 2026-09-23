import type {
  Account,
  AdminActionResult,
  AdminInvite,
  AdminReplay,
  AdminUser,
  AdminUserPatch,
  AssetManifest,
  ChampionStats,
  ConnectionState,
  DashboardData,
  FoxfireClient,
  ImportProgress,
  ImportResult,
  MasteryData,
  MatchDetail,
  MatchSummary,
  PlayerSearchResult,
  QueueType,
  RankHistory,
  RankRange,
  Season,
  SeasonInput,
  ServerAdminSettings,
  ServerStorageUsage,
  SyncProgressEvent,
  SyncState
} from '@foxfire/core'
import { rankMovement, rangeBounds, resetsBetween, seasonsSpanning } from '@foxfire/core'
import { DEV_SEASONS } from './seasons'
import { DDRAGON_MANIFEST } from './ddragonManifest'
import {
  ACCOUNTS,
  LEAGUE_ENTRIES,
  MASTERY,
  MATCHES,
  MATCH_DETAILS,
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
  }
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

export function createFixtureClient(): FoxfireClient {
  return {
    connection: {
      get: (): Promise<ConnectionState> => delay(connection, 120, false),
      onChanged: (cb) => {
        connectionListeners.add(cb)
        return () => connectionListeners.delete(cb)
      }
    },

    accounts: {
      list: (): Promise<Account[]> => delay(accounts(), 180, false),
      getHome: (): Promise<Account | null> => delay(accounts()[0] ?? null, 180, false),
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
        delay(MATCH_DETAILS[matchId] ?? null, 420),
      matchSummary: (accountId: string, matchId: string): Promise<MatchSummary | null> =>
        delay(matchesFor(accountId).find((m) => m.matchId === matchId) ?? null, 200)
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
      }
    },

    search: {
      // The same substring rule the server applies, so the harness answers a
      // half-typed name the way a real one does. Blank is everybody, which is
      // what the finder opens on.
      players: (query: string): Promise<PlayerSearchResult[]> => {
        const needle = query.trim().toLowerCase()

        const matches = ACCOUNTS.filter(
          (account) =>
            needle.length === 0 ||
            account.gameName.toLowerCase().includes(needle) ||
            account.tagLine.toLowerCase().includes(needle) ||
            `${account.gameName}#${account.tagLine}`.toLowerCase().includes(needle)
        )

        return delay(
          matches.map((account) => ({
            account,
            soloEntry:
              (LEAGUE_ENTRIES[account.id] ?? []).find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? null
          })),
          200
        )
      }
    },

    admin: {
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

      invites: (): Promise<AdminInvite[]> => delay(mockInvites, 200, false),

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
      }
    }
  }
}

/**
 * A stats.db import that reports its way through the phases and finishes with
 * a tally.
 *
 * The harness has no file system and no server, so this is the one shape the
 * panel has to draw for real. Either platform's harness can hand it to the
 * Data & storage page.
 */
export async function runFixtureImport(
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  for (const [phase, total] of [['accounts', 3], ['matches', 412], ['readings', 190]] as const) {
    for (const current of [0, total / 2, total]) {
      onProgress({ phase, current: Math.round(current), total })
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }

  onProgress({ phase: 'finishing', current: 0, total: 0 })
  await new Promise((resolve) => setTimeout(resolve, 400))
  onProgress({ phase: 'done', current: 0, total: 0 })

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
}
