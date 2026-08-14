import type {
  Account,
  AdHocSummonerResult,
  AppSettingsPublic,
  AssetManifest,
  LeagueEntry,
  LiveGameData,
  MasteryEntry,
  MatchDetail,
  MatchSummary,
  RiotIdInput,
  SyncProgressEvent,
  SyncState,
  WinRateEntry
} from './types'

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
    matchList: (accountId: number, limit: number, offset: number) => Promise<MatchSummary[]>
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
  mastery: {
    get: (accountId: number, refresh: boolean) => Promise<MasteryData>
  }
  search: {
    summoner: (input: RiotIdInput) => Promise<AdHocSummonerResult>
  }
}

export interface MasteryData {
  riotMastery: MasteryEntry[]
  localWinRates: WinRateEntry[]
}
