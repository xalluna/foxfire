import type { Api, DashboardData, MasteryData, ValidateResult } from '@shared/api'
import type {
  Account,
  AdHocSummonerResult,
  AppSettingsPublic,
  AssetManifest,
  BackgroundSettings,
  LcuStatus,
  LeagueEntry,
  LiveGameData,
  MatchDetail,
  MatchSummary,
  QueueType,
  RankHistory,
  RankRange,
  SyncProgressEvent,
  SyncState
} from '@shared/types'
import { rankMovement } from '@shared/ladder'
import { DDRAGON_MANIFEST } from './ddragonManifest'
import {
  ACCOUNTS,
  LEAGUE_ENTRIES,
  LIVE_GAME,
  MASTERY,
  MATCHES,
  MATCH_DETAILS,
  RANK_SNAPSHOTS,
  winRatesFor
} from './fixtures'

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

function currentScenario(): Scenario {
  const raw = new URLSearchParams(window.location.search).get('scenario')
  return (raw ?? 'default') as Scenario
}

const scenario = currentScenario()

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

function matchesFor(accountId: number): MatchSummary[] {
  if (scenario === 'no-matches') return []
  // Only the home account has a synced history in the fixtures.
  return accountId === 1 ? MATCHES : MATCHES.slice(0, 4)
}

function syncState(accountId: number): SyncState {
  return {
    accountId,
    mostRecentMatchId: MATCHES[0]?.matchId ?? null,
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
function runFakeSync(accountId: number): void {
  if (scenario === 'sync-error') {
    setTimeout(() => {
      for (const cb of progressListeners) {
        cb({ accountId, phase: 'error', current: 0, total: 100, message: 'Riot API unreachable' })
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
        message: done ? undefined : `Fetching match ${current} of ${total}`
      })
    }
    if (done) clearInterval(tick)
  }, 220)
}

export const mockApi: Api = {
  settings: {
    get: (): Promise<AppSettingsPublic> =>
      delay(
        {
          hasApiKey: scenario !== 'no-key',
          homeAccountId: scenario === 'no-accounts' ? null : 1
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
    clearApiKey: (): Promise<AppSettingsPublic> => delay({ hasApiKey: false, homeAccountId: 1 }),
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
          id: Date.now(),
          puuid: `puuid-${input.gameName}`,
          gameName: input.gameName,
          tagLine: input.tagLine,
          isHomeAccount: false
        },
        700
      ),
    remove: (accountId: number): Promise<Account[]> =>
      delay(accounts().filter((a) => a.id !== accountId)),
    setHome: (accountId: number): Promise<Account[]> =>
      delay(accounts().map((a) => ({ ...a, isHomeAccount: a.id === accountId })))
  },

  dashboard: {
    get: (accountId: number): Promise<DashboardData | null> => {
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
      accountId: number,
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
    start: (accountId: number): Promise<void> => {
      runFakeSync(accountId)
      return delay(undefined, 100)
    },
    getState: (accountId: number): Promise<SyncState | null> => delay(syncState(accountId)),
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

  liveGame: {
    check: (): Promise<LiveGameData | null> =>
      scenario === 'not-live' ? delay(null, 800) : delay(LIVE_GAME, 800),
    participantRank: (): Promise<LeagueEntry | null> => delay(LEAGUE_ENTRIES[1][0], 500),
    participantName: (): Promise<{ gameName: string; tagLine: string } | null> =>
      delay({ gameName: 'Resolved Later', tagLine: 'NA1' }, 700)
  },

  mastery: {
    get: (_accountId: number, _refresh: boolean, queueId: number | null): Promise<MasteryData> =>
      delay(
        {
          // Mastery is lifetime and never narrows; only the win rates do.
          riotMastery: MASTERY,
          localWinRates: winRatesFor(queueId)
        },
        300
      )
  },

  rank: {
    history: (_accountId: number, queueType: QueueType, range: RankRange): Promise<RankHistory> => {
      const since = range === 'all' ? 0 : Date.now() - (range === '7d' ? 7 : 30) * 86_400_000
      const snapshots = RANK_SNAPSHOTS[queueType].filter((s) => s.capturedAt >= since)

      const milestones = snapshots
        .flatMap((snapshot, i) => {
          if (i === 0) return []
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
    }
  },

  // The browser harness has no League client and no Electron main process, so
  // these report the states the renderer must handle rather than pretending to
  // be connected: a disconnected client, background features switched off.
  lcu: {
    getStatus: (): Promise<LcuStatus> => delay({ state: 'disconnected' }, 100),
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
            profileIconId: 5789,
            summonerLevel: 214
          },
          leagueEntries: LEAGUE_ENTRIES[2],
          recentMatches: MATCHES.slice(0, 10)
        },
        900
      )
    }
  }
}

export function installMockApi(): void {
  window.api = mockApi
  document.documentElement.dataset.harness = scenario
}
