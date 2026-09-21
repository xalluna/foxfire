import type {
  Account,
  AdHocSummonerResult,
  AdminActionResult,
  AdminInvite,
  AdminReplay,
  AdminUser,
  AdminUserPatch,
  AssetManifest,
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
  ServerAdminSettings,
  ServerStorageUsage,
  SyncProgressEvent,
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

/** Stops listening. Every subscription below hands one back. */
export type Unsubscribe = () => void

/**
 * Where the data is coming from, and who is asking.
 *
 * The desktop can be local-only or connected to a server; the web client is
 * always the latter. A screen reads this to decide what to offer — the admin
 * pages, a "Copy link" — and never to decide what is allowed, which is the
 * server's call on every request.
 */
export interface ConnectionState {
  mode: 'local' | 'server'
  /**
   * The server's public address, which is what a share link is built on.
   *
   * Null in local-only mode, where there is no web client to open one, and
   * from a server too old to say. Never the address the desktop happened to
   * connect with, which may be a LAN name nobody else can reach.
   */
  publicUrl: string | null
  serverName: string | null
  /** Who is signed in. Null in local-only mode, and while signed out. */
  session: { username: string; email: string; isAdmin: boolean } | null
  /** The server's own Riot key has been refused — the host's to fix, not the reader's. */
  riotKeyRejected: boolean
  /** Set when the server refused this client outright, with the version it wants. */
  upgradeRequired: string | null
}

/**
 * Everything the shared screens reach for, from whichever client mounts them.
 *
 * FoxfireData plus what a screen needs around it: the asset manifest, the
 * connection, a server's admin surface, and the events that tell a screen its
 * data changed underneath it. The desktop implements it over IPC and the web
 * client over HTTP, and the screens cannot tell which they were given.
 */
export interface FoxfireClient extends FoxfireData {
  connection: {
    get: () => Promise<ConnectionState>
    onChanged: (cb: (state: ConnectionState) => void) => Unsubscribe
  }
  assets: {
    /** The current patch's champion, spell and rune lookups. Changes on patch day and no other time. */
    get: () => Promise<AssetManifest>
  }
  /**
   * Administering a server. Only offered to somebody the connection says is an
   * admin, and only ever authoritative because the server checks the role
   * itself on every request. Reads throw; writes answer with a result, because
   * a refused write has a reason worth showing.
   */
  admin: {
    users: () => Promise<AdminUser[]>
    updateUser: (id: string, patch: AdminUserPatch) => Promise<AdminActionResult>
    deleteUser: (id: string) => Promise<AdminActionResult>
    invites: () => Promise<AdminInvite[]>
    /** Returns the outstanding invite for that address if there already is one. */
    createInvite: (email: string) => Promise<AdminInvite>
    revokeInvite: (id: string) => Promise<AdminActionResult>
    getSettings: () => Promise<ServerAdminSettings>
    setSettings: (patch: Partial<ServerAdminSettings>) => Promise<ServerAdminSettings>
    storage: () => Promise<ServerStorageUsage>
    /** The biggest shared replays, so space can be reclaimed where it actually is. */
    storedReplays: () => Promise<AdminReplay[]>
    removeReplay: (matchId: string) => Promise<AdminActionResult>
    /** Takes a League account away from whoever claimed it. The account and its games stay. */
    forceUnlink: (riotAccountId: string) => Promise<AdminActionResult>
  }
  /** What changed underneath the screens, from wherever the change happened. */
  events: {
    onSyncProgress: (cb: (event: SyncProgressEvent) => void) => Unsubscribe
    /** Somebody entered LP by hand on this account. */
    onRankEdited: (cb: (accountId: string) => void) => Unsubscribe
    /** A League client recorded a rank that moved. */
    onRankChanged: (cb: (accountId: string) => void) => Unsubscribe
  }
}
