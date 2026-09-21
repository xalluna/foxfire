import type {
  Account,
  AdHocSummonerResult,
  ChampionStats,
  DashboardData,
  EditableMatch,
  ManualRankEdit,
  MasteryData,
  MatchDetail,
  MatchSummary,
  QueueType,
  RankHistory,
  RankRange,
  RiotIdInput,
  Season,
  SeasonInput,
  SyncState
} from './types'

/**
 * Everything a screen reads and writes about League data, whoever answers.
 *
 * Three things answer it. The desktop's own SQLite in local-only mode; a
 * Foxfire Server, reached from the desktop's main process; and the same server
 * reached from a browser. A screen is handed one of them and cannot tell which,
 * which is the whole design: it is why one set of screens can serve the
 * desktop and the web client both.
 *
 * Deliberately only what every answerer can do. Adding an account by a typed
 * Riot ID is local-only, and claiming one is attested by a running League
 * client; both belong to the desktop and are not here.
 */
export interface FoxfireData {
  accounts: {
    list: () => Promise<Account[]>
    getHome: () => Promise<Account | null>
    /**
     * Stops following an account. On a server that gives up the claim and
     * leaves the history, which is everybody's.
     */
    remove: (accountId: string) => Promise<Account[]>
    /** Which account opens first. A preference of the machine or browser, never of the server. */
    setHome: (accountId: string) => Promise<Account[]>
  }
  dashboard: {
    get: (accountId: string) => Promise<DashboardData | null>
    /** `queueId` null means every queue; filtering happens where the rows are, so paging stays even. */
    matchList: (
      accountId: string,
      limit: number,
      offset: number,
      queueId: number | null
    ) => Promise<MatchSummary[]>
    matchDetail: (matchId: string) => Promise<MatchDetail | null>
  }
  sync: {
    start: (accountId: string) => Promise<void>
    getState: (accountId: string) => Promise<SyncState | null>
  }
  champions: {
    stats: (accountId: string, queueId: number | null, range: RankRange) => Promise<ChampionStats[]>
  }
  mastery: {
    /** Win rates are scoped to `queueId`; Riot mastery is lifetime and never is. */
    get: (accountId: string, refresh: boolean, queueId: number | null) => Promise<MasteryData>
  }
  rank: {
    history: (accountId: string, queueType: QueueType, range: RankRange) => Promise<RankHistory>
    /** Seasons with data, newest first. The first is what the pickers open on. */
    periods: (accountId: string) => Promise<Season[]>
    /** Ranked games with no LP figure — everything the editor can offer. */
    editable: (accountId: string, queueType: QueueType) => Promise<EditableMatch[]>
    /**
     * Stores a batch of entries and returns what still needs one. Fewer rows can
     * come back than were left: stating the rank after two games of a run of
     * three resolves the third on its own.
     */
    saveManual: (
      accountId: string,
      queueType: QueueType,
      edits: ManualRankEdit[]
    ) => Promise<EditableMatch[]>
    clearManual: (accountId: string, queueType: QueueType, matchId: string) => Promise<EditableMatch[]>
  }
  /**
   * Ranked season boundaries, entered by hand — Riot exposes none, and the
   * calendar is not a stand-in for one. Saving replaces the whole list.
   */
  seasons: {
    list: () => Promise<Season[]>
    save: (seasons: SeasonInput[]) => Promise<Season[]>
  }
  search: {
    summoner: (input: RiotIdInput) => Promise<AdHocSummonerResult>
  }
}
