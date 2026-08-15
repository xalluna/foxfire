import type {
  Account,
  AdHocSummonerResult,
  AppSettingsPublic,
  AssetManifest,
  BackgroundSettings,
  ChampionStats,
  LcuStatus,
  LeagueEntry,
  LiveGameData,
  MasteryEntry,
  MatchDetail,
  MatchSummary,
  QueueType,
  RankHistory,
  RankRange,
  RiotIdInput,
  SyncProgressEvent,
  SyncState
} from './types'
import type {
  LcuTelemetry,
  RateLimitSeries,
  ResourceData,
  TelemetryRequest,
  TelemetryRequestQuery,
  TelemetryState,
  TelemetrySummary
} from './telemetry'

export interface ValidateResult {
  ok: boolean
  message?: string
}

export interface DashboardData {
  account: Account
  leagueEntries: LeagueEntry[]
  syncState: SyncState | null
}

// The typed contract exposed by src/preload/index.ts via contextBridge and
// consumed by the renderer as `window.api`. Grows as IPC handlers are added
// in src/main/ipc/handlers.ts — this file is the single source of truth for
// the shape both sides must agree on.
export interface Api {
  settings: {
    get: () => Promise<AppSettingsPublic>
    setApiKey: (key: string) => Promise<ValidateResult>
    clearApiKey: () => Promise<AppSettingsPublic>
    /** Fires when Riot rejects the stored key (personal keys expire every 24h). */
    onKeyInvalid: (cb: () => void) => () => void
  }
  accounts: {
    list: () => Promise<Account[]>
    getHome: () => Promise<Account | null>
    add: (input: RiotIdInput) => Promise<Account>
    remove: (accountId: number) => Promise<Account[]>
    setHome: (accountId: number) => Promise<Account[]>
  }
  dashboard: {
    get: (accountId: number) => Promise<DashboardData | null>
    /** `queueId` null means every queue; filtering happens in SQL so paging stays even. */
    matchList: (
      accountId: number,
      limit: number,
      offset: number,
      queueId: number | null
    ) => Promise<MatchSummary[]>
    matchDetail: (matchId: string) => Promise<MatchDetail | null>
  }
  sync: {
    start: (accountId: number) => Promise<void>
    getState: (accountId: number) => Promise<SyncState | null>
    onProgress: (cb: (event: SyncProgressEvent) => void) => () => void
  }
  assets: {
    get: () => Promise<AssetManifest>
  }
  liveGame: {
    check: (accountId: number) => Promise<LiveGameData | null>
    participantRank: (platform: string, puuid: string) => Promise<LeagueEntry | null>
    participantName: (
      regionalRoute: string,
      puuid: string
    ) => Promise<{ gameName: string; tagLine: string } | null>
  }
  champions: {
    /** Local-only, so the Champions screen renders whatever the API key is doing. */
    stats: (accountId: number, queueId: number | null) => Promise<ChampionStats[]>
  }
  mastery: {
    /** Win rates are scoped to `queueId`; Riot mastery is lifetime and never is. */
    get: (accountId: number, refresh: boolean, queueId: number | null) => Promise<MasteryData>
  }
  rank: {
    history: (accountId: number, queueType: QueueType, range: RankRange) => Promise<RankHistory>
  }
  lcu: {
    getStatus: () => Promise<LcuStatus>
    onStatus: (cb: (status: LcuStatus) => void) => () => void
    /** Fires when the watcher records an LP change, so views can refetch. */
    onRankChanged: (cb: (accountId: number) => void) => () => void
  }
  background: {
    get: () => Promise<BackgroundSettings>
    set: (patch: Partial<BackgroundSettings>) => Promise<BackgroundSettings>
  }
  search: {
    summoner: (input: RiotIdInput) => Promise<AdHocSummonerResult>
  }
  /**
   * Developer telemetry. Off by default; reads still work with collection
   * disabled so history stays visible after switching it off.
   */
  telemetry: {
    getState: () => Promise<TelemetryState>
    setEnabled: (enabled: boolean) => Promise<TelemetryState>
    openWindow: () => Promise<void>
    clear: () => Promise<TelemetryState>
    requests: (query: TelemetryRequestQuery) => Promise<TelemetryRequest[]>
    endpoints: (windowMs: number) => Promise<string[]>
    summary: (windowMs: number) => Promise<TelemetrySummary>
    /** Riot's own reported counters — the limiter never reads these itself. */
    rateLimit: (windowMs: number) => Promise<RateLimitSeries>
    resources: (windowMs: number) => Promise<ResourceData>
    lcu: (windowMs: number) => Promise<LcuTelemetry>
  }
}

export interface MasteryData {
  riotMastery: MasteryEntry[]
  localWinRates: ChampionStats[]
}
