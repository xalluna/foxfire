import type {
  AdminReplay,
  ImportProgress,
  ImportResult,
  ServerStorageUsage,
  Account,
  AdHocSummonerResult,
  AdminActionResult,
  AdminInvite,
  AdminUser,
  AdminUserPatch,
  AppSettingsPublic,
  ArchiveCopyProgress,
  ArchiveResult,
  AssetManifest,
  BackgroundSettings,
  CaptureSettings,
  CaptureStatus,
  ChampionStats,
  ClientArchive,
  EditableMatch,
  IdentityReport,
  InvitePreview,
  LcuStatus,
  LeagueEntry,
  LiveClient,
  ManualRankEdit,
  MasteryEntry,
  MatchDetail,
  MatchSummary,
  ObsValidation,
  QueueType,
  RankHistory,
  RankRange,
  Recording,
  RecordingDetail,
  RecordingDiskUsage,
  Replay,
  ReplayDiskUsage,
  ReplayImportProgress,
  ReplayLaunchResult,
  RiotIdInput,
  RiotKeyLimits,
  RiotKeyType,
  RoflSettings,
  Scoreboard,
  Season,
  SeasonInput,
  ServerAuthResult,
  ServerCredentials,
  ServerProbe,
  ServerAdminSettings,
  ServerRegistration,
  ServerState,
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
  /**
   * How each tracked account fared when it was re-resolved under the new key.
   * Riot encrypts puuids per key, so saving a different one re-links every
   * account. Absent when the key did not change.
   */
  identities?: IdentityReport[]
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
  app: {
    /** The packaged version, matching the CHANGELOG entry the build shipped with. */
    getVersion: () => Promise<string>
  }
  /**
   * Joining a Foxfire server, and choosing which one answers.
   *
   * Everything here is about the connection itself rather than the data
   * behind it. Once connected, the rest of this interface is unchanged: the
   * renderer goes on calling the same methods and does not learn whether the
   * answers came from this machine or from a server.
   */
  server: {
    getState: () => Promise<ServerState>
    /** Asks a server what it is. Never rejects — every failure is in the probe. */
    probe: (url: string) => Promise<ServerProbe>
    /** Accepts the code or the whole link, and says whether it can still be used. */
    previewInvite: (url: string, token: string) => Promise<InvitePreview>
    register: (url: string, registration: ServerRegistration) => Promise<ServerAuthResult>
    login: (url: string, credentials: ServerCredentials) => Promise<ServerAuthResult>
    /** Signs out of the active server and forgets its credential. */
    logout: () => Promise<ServerState>
    /** Null is local-only mode. Not the same as signing out: the credential stays. */
    setActive: (url: string | null) => Promise<ServerState>
    forget: (url: string) => Promise<ServerState>
    /** Fires whenever the connection changes, including from a background refresh. */
    onChanged: (cb: (state: ServerState) => void) => () => void
  }
  /**
   * Administering the active server.
   *
   * Only shown to somebody whose session says they are an admin, and only
   * ever authoritative because the server checks the role itself — the flag
   * on the session decides what to draw, never what is allowed.
   */
  serverAdmin: {
    users: () => Promise<AdminUser[]>
    updateUser: (id: string, patch: AdminUserPatch) => Promise<AdminActionResult>
    deleteUser: (id: string) => Promise<AdminActionResult>
    invites: () => Promise<AdminInvite[]>
    /** Returns the outstanding invite for that address if there already is one. */
    createInvite: (email: string) => Promise<AdminInvite>
    revokeInvite: (id: string) => Promise<AdminActionResult>
    getSettings: () => Promise<ServerAdminSettings>
    setSettings: (patch: Partial<ServerAdminSettings>) => Promise<ServerAdminSettings>
    /** Opens a file picker. Resolves with null when it was dismissed. */
    /** What the server is holding, for the Data & storage page. */
    storage: () => Promise<ServerStorageUsage>
    /** The biggest shared replays, so space can be reclaimed where it actually is. */
    storedReplays: () => Promise<AdminReplay[]>
    /** Removes a shared replay, blob and record. Anybody who played the game can upload it again. */
    removeReplay: (matchId: string) => Promise<AdminActionResult>
    /**
     * Takes a League account away from whoever claimed it.
     *
     * The escape hatch first-claim-wins needs to be survivable: somebody claims
     * an account that is not theirs, or leaves still holding one. The account
     * and its games stay; only the claim goes.
     */
    forceUnlink: (riotAccountId: string) => Promise<AdminActionResult>
    chooseDatabase: () => Promise<string | null>
    /**
     * Reads an old stats.db and pushes it at the active server.
     *
     * Minutes long, so the answer arrives in pieces on onImportProgress and
     * this resolves once with the tally.
     */
    importDatabase: (filePath: string) => Promise<ImportResult>
    onImportProgress: (cb: (progress: ImportProgress) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettingsPublic>
    setApiKey: (key: string) => Promise<ValidateResult>
    clearApiKey: () => Promise<AppSettingsPublic>
    /** Personal or application, and for the latter the allowance it was granted. */
    setKeyType: (keyType: RiotKeyType, limits?: RiotKeyLimits) => Promise<AppSettingsPublic>
    /** Fires when Riot rejects the stored key (personal keys expire every 24h). */
    onKeyInvalid: (cb: () => void) => () => void
  }
  accounts: {
    list: () => Promise<Account[]>
    getHome: () => Promise<Account | null>
    add: (input: RiotIdInput) => Promise<Account>
    remove: (accountId: string) => Promise<Account[]>
    setHome: (accountId: string) => Promise<Account[]>
  }
  dashboard: {
    get: (accountId: string) => Promise<DashboardData | null>
    /** `queueId` null means every queue; filtering happens in SQL so paging stays even. */
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
    onProgress: (cb: (event: SyncProgressEvent) => void) => () => void
  }
  assets: {
    get: () => Promise<AssetManifest>
  }
  /**
   * The in-game scoreboard, read from the game running on this machine over the
   * Live Client Data API on 127.0.0.1:2999. Costs no Riot call and needs no key,
   * so it works identically in local-only and server mode.
   */
  liveClient: {
    /** Null whenever no game is running on this machine, which is not an error. */
    scoreboard: (accountId: string) => Promise<Scoreboard | null>
  }
  champions: {
    /** Local-only, so the Champions screen renders whatever the API key is doing. */
    stats: (
      accountId: string,
      queueId: number | null,
      range: RankRange
    ) => Promise<ChampionStats[]>
  }
  /**
   * Ranked season boundaries, entered by hand — Riot exposes none, and the
   * calendar is not a stand-in for one. Saving replaces the whole list.
   */
  seasons: {
    list: () => Promise<Season[]>
    save: (seasons: SeasonInput[]) => Promise<Season[]>
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
    clearManual: (
      accountId: string,
      queueType: QueueType,
      matchId: string
    ) => Promise<EditableMatch[]>
    openEditor: (accountId: string, queueType: QueueType, matchId: string) => Promise<void>
    /** Fires after any edit, so the match list and rank graph refetch. */
    onEdited: (cb: (accountId: string) => void) => () => void
    /** Fires when an already-open editor is asked to show a different game. */
    onEditorFocus: (cb: (matchId: string) => void) => () => void
  }
  lcu: {
    getStatus: () => Promise<LcuStatus>
    onStatus: (cb: (status: LcuStatus) => void) => () => void
    /** Fires when the watcher records an LP change, so views can refetch. */
    onRankChanged: (cb: (accountId: string) => void) => () => void
  }
  background: {
    get: () => Promise<BackgroundSettings>
    set: (patch: Partial<BackgroundSettings>) => Promise<BackgroundSettings>
  }
  /** Recording games as they are played, through a local OBS over its websocket. */
  capture: {
    getSettings: () => Promise<CaptureSettings>
    set: (patch: Partial<CaptureSettings>) => Promise<CaptureSettings>
    /** Write-only. The stored password never comes back — only `hasObsPassword`. */
    setObsPassword: (password: string) => Promise<CaptureSettings>
    clearObsPassword: () => Promise<CaptureSettings>
    /** Native folder picker. Null when the user cancels. */
    chooseFolder: () => Promise<string | null>
    chooseObsPath: () => Promise<string | null>
    getStatus: () => Promise<CaptureStatus>
    onStatus: (cb: (status: CaptureStatus) => void) => () => void
    /** What OBS is configured to do, and everything wrong with it. */
    validate: () => Promise<ObsValidation>
    /** One frame of the capture source as a data URI, or null when unavailable. */
    preview: () => Promise<string | null>
    reconnect: () => Promise<CaptureStatus>
  }
  recordings: {
    /** Every recording for an account, newest first, bound or not. */
    list: (accountId: string) => Promise<Recording[]>
    detail: (recordingId: number) => Promise<RecordingDetail | null>
    usage: () => Promise<RecordingDiskUsage>
    remove: (recordingId: number) => Promise<void>
    /** Deletes the N oldest recordings, for the one-click cleanup on the cap warning. */
    removeOldest: (accountId: string, count: number) => Promise<number>
    /** Opens a window owning this recording. Called again, it opens another one. */
    open: (recordingId: number) => Promise<void>
    reveal: (recordingId: number) => Promise<void>
    /** Fires when a recording is added, bound or deleted. */
    onChanged: (cb: () => void) => () => void
    /** Sent by a recording window; the main window focuses and expands that match. */
    showMatch: (accountId: string, matchId: string) => Promise<void>
    onShowMatch: (cb: (accountId: string, matchId: string) => void) => () => void
  }
  /**
   * Riot's own replays. No detail call and no player: a .rofl is handed to the
   * League client, which already plays it better than Foxfire could.
   */
  /**
   * The real path of a File the user dropped or picked.
   *
   * Electron stopped exposing File.path in 32, so this has to come from the
   * preload. It is the whole reason drag-and-drop is worth having here: the main
   * process copies straight from the original, and the renderer never reads a
   * byte of a 30 MB replay.
   */
  pathForFile: (file: File) => string | null
  replays: {
    list: (accountId: string) => Promise<Replay[]>
    usage: (accountId: string) => Promise<ReplayDiskUsage>
    /** Resolves with why it could not be opened, or null when it opened. */
    open: (replayId: number) => Promise<ReplayLaunchResult>
    reveal: (replayId: number) => Promise<void>
    remove: (replayId: number) => Promise<void>
    add: (filePath: string) => Promise<{ ok: boolean; replay: Replay | null }>
    link: (replayId: number, matchId: string) => Promise<void>
    /**
     * Fetches the replay the active server holds for a game.
     *
     * Resolves with the new local replay's id, or null when there was nothing
     * to fetch — a server with no copy, no blob store, or local-only mode. Once
     * it lands it is an ordinary replay: it lists, it plays, and removing it
     * works like any other.
     */
    download: (matchId: string) => Promise<number | null>
    rescan: () => Promise<number>
    settings: () => Promise<RoflSettings>
    setSettings: (patch: Partial<RoflSettings>) => Promise<RoflSettings>
    chooseSourceFolder: () => Promise<string | null>
    onChanged: (cb: () => void) => () => void
    onImportProgress: (cb: (progress: ReplayImportProgress) => void) => () => void
  }
  /** League installs kept so replays from older patches stay watchable. */
  archives: {
    list: () => Promise<ClientArchive[]>
    add: (path: string, label: string | null) => Promise<ArchiveResult>
    remove: (id: number) => Promise<void>
    setPatch: (id: number, patch: string) => Promise<{ ok: boolean; error?: string }>
    live: () => Promise<LiveClient>
    choosePath: () => Promise<string | null>
    archiveLive: (destination: string) => Promise<ArchiveResult>
    cancelCopy: () => Promise<void>
    onCopyProgress: (cb: (progress: ArchiveCopyProgress) => void) => () => void
    openWindow: () => Promise<void>
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
    /** Re-attributes LP across all stored history. Returns the games attributed. */
    replayAttribution: () => Promise<number>
    /** Starts the post-game sync schedule by hand. False when no account exists. */
    simulateGameEnd: () => Promise<boolean>
  }
}

export interface MasteryData {
  riotMastery: MasteryEntry[]
  localWinRates: ChampionStats[]
}
