import type {
  Account,
  AdminActionResult,
  AdminInvite,
  AdminPasswordReset,
  AdminReplay,
  AdminUser,
  AdminUserPatch,
  AssetManifest,
  AttachRecordingInput,
  AttachRecordingOutcome,
  ChampionStats,
  DashboardData,
  EditableMatch,
  FavoriteOutcome,
  FavoritePlayer,
  ManualRankEdit,
  MasteryData,
  MatchDetail,
  MatchRecording,
  MatchSummary,
  PlayerSearchOptions,
  PlayerSearchResult,
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
  /**
   * Accounts, asked about one question at a time.
   *
   * There is no "every account". There used to be, and every screen held the
   * whole list and searched it for whichever account it meant — which on a
   * server is the whole community, fetched by every client on every launch.
   * Yours are a list, because that is as many as one person plays on; anybody
   * else's is one lookup, or a page of `search.players`.
   */
  accounts: {
    /**
     * The accounts that are yours, with the home one marked. On a server, the
     * ones you have claimed; locally, every account in this file.
     */
    mine: () => Promise<Account[]>
    /** One account by id, or null when there is no such account. */
    get: (accountId: string) => Promise<Account | null>
    /** One account by Riot ID, in any capitalisation, or null when nobody here plays as it. */
    find: (riotId: RiotIdInput) => Promise<Account | null>
    /** The account this machine or browser opens on, or null when there is none to open. */
    getHome: () => Promise<Account | null>
    /**
     * Stops following an account, and answers with yours. On a server that
     * gives up the claim and leaves the history, which is everybody's.
     */
    remove: (accountId: string) => Promise<Account[]>
    /**
     * Which account opens first, answered with yours. A preference of the
     * machine or browser, never of the server — and it may be somebody else's.
     */
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
    /**
     * One game as one player's row — the result, the queue, the LP it moved.
     *
     * Optional because only a client with a page for a single game needs it,
     * and the desktop has none: it opens a game where it sits in the history.
     * A screen that uses it has to cope with its absence.
     */
    matchSummary?: (accountId: string, matchId: string) => Promise<MatchSummary | null>
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
    /**
     * A page of the tracked players matching a query, closest first (see
     * `compareSearchResults`), or of everybody in name order when it is blank.
     * Reads stored data only — no Riot call, on a server or a desktop.
     */
    players: (query: string, options?: PlayerSearchOptions) => Promise<PlayerSearchResult[]>
  }
  /**
   * The players somebody starred, for the search box to open on.
   *
   * Kept by the machine or browser asking, like the home account, and never by
   * a server: each keeps a copy of every player it starred, so the list draws
   * before anything has been asked of anybody. Ten at most, newest first; see
   * `addFavorite`. Local-only has no community to star anybody in, so there it
   * is always empty.
   */
  favorites: {
    list: () => Promise<FavoritePlayer[]>
    /** Stars a player, or says why not — a full list is refused, not trimmed. */
    add: (player: PlayerSearchResult) => Promise<FavoriteOutcome>
    remove: (accountId: string) => Promise<FavoritePlayer[]>
    /** Brings any starred player among these up to date, and answers with the list. */
    refresh: (seen: PlayerSearchResult[]) => Promise<FavoritePlayer[]>
  }
  /**
   * The YouTube recordings a server holds, one per game per account.
   *
   * Keyed by the pair on purpose: a recording is one player's screen, so the
   * account whose history is open is part of the question. Only that account's
   * owner can attach one; its owner or an admin can take it off again, which
   * never touches the video on YouTube.
   *
   * Optional because local-only has no server to hold one. There, a recording
   * that went to YouTube keeps its video on the desktop's own recording row.
   */
  matchRecordings?: {
    get: (accountId: string, matchId: string) => Promise<MatchRecording | null>
    attach: (
      accountId: string,
      matchId: string,
      input: AttachRecordingInput
    ) => Promise<AttachRecordingOutcome>
    detach: (accountId: string, matchId: string) => Promise<AdminActionResult>
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
    /** Makes a reset link for somebody, replacing whatever was outstanding for them. */
    createPasswordReset: (userId: string) => Promise<AdminPasswordReset>
    /** Withdraws the reset link outstanding for somebody, if there is one. */
    revokePasswordReset: (userId: string) => Promise<AdminActionResult>
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
    /**
     * Starts tracking a League account nobody here has claimed, and backfills it.
     *
     * Unlike linking, this claims nothing for the caller: the account arrives
     * with no owner, the state an imported one already has.
     */
    addRiotAccount: (input: RiotIdInput) => Promise<Account>
  }
  /** What changed underneath the screens, from wherever the change happened. */
  events: {
    onSyncProgress: (cb: (event: SyncProgressEvent) => void) => Unsubscribe
    /** Somebody entered LP by hand on this account. */
    onRankEdited: (cb: (accountId: string) => void) => Unsubscribe
    /** A League client recorded a rank that moved. */
    onRankChanged: (cb: (accountId: string) => void) => Unsubscribe
    /** A recording was attached to one account's game, replaced, or taken off it. */
    onRecordingChanged: (cb: (event: { accountId: string; matchId: string }) => void) => Unsubscribe
  }
}
