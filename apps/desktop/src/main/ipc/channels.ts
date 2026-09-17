// Shared channel names — imported by both the main-process handlers and the
// preload bridge so the two sides can't drift apart.
export const CH = {
  app: {
    getVersion: 'app:getVersion'
  },
  settings: {
    get: 'settings:get',
    setApiKey: 'settings:setApiKey',
    clearApiKey: 'settings:clearApiKey',
    setKeyType: 'settings:setKeyType',
    keyInvalid: 'settings:keyInvalid'
  },
  accounts: {
    list: 'accounts:list',
    getHome: 'accounts:getHome',
    add: 'accounts:add',
    remove: 'accounts:remove',
    setHome: 'accounts:setHome'
  },
  dashboard: {
    get: 'dashboard:get',
    matchList: 'dashboard:matchList',
    matchDetail: 'dashboard:matchDetail'
  },
  sync: {
    start: 'sync:start',
    getState: 'sync:getState',
    progress: 'sync:progress'
  },
  // Read from the game running on this machine, so it costs no Riot call and
  // needs no key. It used to have a playerRank sibling that resolved each row's
  // ladder standing at two Riot calls a player — twenty per board. That is a lot
  // of a shared server's budget for a number nobody could act on, and without
  // op.gg-scale history behind it the ranks were not worth what they cost.
  liveClient: {
    scoreboard: 'liveClient:scoreboard'
  },
  // Separate from mastery:get on purpose. Champion stats are pure SQLite, so
  // they must not sit behind a channel that can reach out to Riot and fail.
  champions: {
    stats: 'champions:stats'
  },
  mastery: {
    get: 'mastery:get'
  },
  // Hand-entered, because Riot exposes no way to ask which season is current
  // and the calendar is not a stand-in for one. See migration 008.
  seasons: {
    list: 'seasons:list',
    save: 'seasons:save'
  },
  rank: {
    history: 'rank:history',
    /** The seasons this account has data in, for the period pickers. */
    periods: 'rank:periods',
    // Hand-entered LP, for the games attribution cannot resolve on its own.
    editable: 'rank:editable',
    saveManual: 'rank:saveManual',
    clearManual: 'rank:clearManual',
    openEditor: 'rank:openEditor',
    /** Broadcast after an edit, so the main window refetches what it is showing. */
    edited: 'rank:edited',
    /** Scrolls an already-open editor to a row, instead of reloading it. */
    editorFocus: 'rank:editorFocus'
  },
  lcu: {
    getStatus: 'lcu:getStatus',
    status: 'lcu:status',
    rankChanged: 'lcu:rankChanged'
  },
  background: {
    get: 'background:get',
    set: 'background:set'
  },
  // Recording the game as it is played. Settings and status are separate reads
  // for the same reason telemetry splits them: the status pill polls, and the
  // settings form does not.
  capture: {
    getSettings: 'capture:getSettings',
    setSettings: 'capture:setSettings',
    /** Write-only, like the Riot key — the password itself never comes back. */
    setObsPassword: 'capture:setObsPassword',
    clearObsPassword: 'capture:clearObsPassword',
    chooseFolder: 'capture:chooseFolder',
    chooseObsPath: 'capture:chooseObsPath',
    getStatus: 'capture:getStatus',
    status: 'capture:status',
    /** What a user-configured OBS would record, and what is wrong with it. */
    validate: 'capture:validate',
    /** A single frame of the capture source, so setup can be checked by eye. */
    preview: 'capture:preview',
    reconnect: 'capture:reconnect'
  },
  recordings: {
    list: 'recordings:list',
    detail: 'recordings:detail',
    usage: 'recordings:usage',
    remove: 'recordings:remove',
    removeOldest: 'recordings:removeOldest',
    /** Opens a window that owns one recording. Repeat calls open more windows. */
    open: 'recordings:open',
    reveal: 'recordings:reveal',
    /** Broadcast when a recording is added, bound or deleted, so lists refetch. */
    changed: 'recordings:changed',
    /** A recording window asking the main window to show its match. */
    showMatch: 'recordings:showMatch'
  },
  // Riot's own replays. Separate from `recordings` throughout: the two are
  // different artefacts with different lifecycles, and one shared domain would
  // mean every call growing a discriminator it could forget to pass.
  replays: {
    list: 'replays:list',
    usage: 'replays:usage',
    /** Hands the .rofl to the League client. Foxfire never plays one itself. */
    open: 'replays:open',
    reveal: 'replays:reveal',
    remove: 'replays:remove',
    /** Adds a file the user picked or dropped. */
    add: 'replays:add',
    /** Links a replay to a match the user chose by hand. */
    link: 'replays:link',
    /** Re-reads Riot's folder now, rather than waiting for the next scan. */
    rescan: 'replays:rescan',
    settings: 'replays:settings',
    setSettings: 'replays:setSettings',
    chooseSourceFolder: 'replays:chooseSourceFolder',
    /** Broadcast when a replay is added, linked or removed, so lists refetch. */
    changed: 'replays:changed',
    /** Progress of the folder import, so the tab can say what is happening. */
    importProgress: 'replays:importProgress'
  },
  // League installs kept around to play replays from older patches.
  archives: {
    list: 'archives:list',
    add: 'archives:add',
    remove: 'archives:remove',
    setPatch: 'archives:setPatch',
    /** Where League is now and which patch it is on, read fresh each time. */
    live: 'archives:live',
    choosePath: 'archives:choosePath',
    /** Copies the live install so this patch stays playable after Riot moves on. */
    archiveLive: 'archives:archiveLive',
    cancelCopy: 'archives:cancelCopy',
    copyProgress: 'archives:copyProgress',
    openWindow: 'archives:openWindow'
  },
  search: {
    summoner: 'search:summoner'
  },
  assets: {
    get: 'assets:get'
  },
  // Developer telemetry. Reads are deliberately separate from `getState` so the
  // panel can poll the cheap table query often and the aggregate rarely.
  telemetry: {
    getState: 'telemetry:getState',
    setEnabled: 'telemetry:setEnabled',
    openWindow: 'telemetry:openWindow',
    clear: 'telemetry:clear',
    requests: 'telemetry:requests',
    endpoints: 'telemetry:endpoints',
    summary: 'telemetry:summary',
    rateLimit: 'telemetry:rateLimit',
    resources: 'telemetry:resources',
    lcu: 'telemetry:lcu',
    // Developer triggers for the post-game path. Both are otherwise reachable
    // only by finishing a real ranked game and waiting on Riot to publish it,
    // which is not a practical way to check whether it works.
    replayAttribution: 'telemetry:replayAttribution',
    simulateGameEnd: 'telemetry:simulateGameEnd'
  }
} as const
