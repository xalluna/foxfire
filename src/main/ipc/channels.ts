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
  // The scoreboard is read from the game running on this machine and costs no
  // Riot call at all; playerRank is the one thing on that screen that does, so
  // it stays a separate channel rather than making the board fail with the key.
  liveClient: {
    scoreboard: 'liveClient:scoreboard',
    playerRank: 'liveClient:playerRank'
  },
  // Separate from mastery:get on purpose. Champion stats are pure SQLite, so
  // they must not sit behind a channel that can reach out to Riot and fail.
  champions: {
    stats: 'champions:stats'
  },
  mastery: {
    get: 'mastery:get'
  },
  rank: {
    history: 'rank:history',
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
  replays: {
    list: 'replays:list',
    detail: 'replays:detail',
    usage: 'replays:usage',
    remove: 'replays:remove',
    removeOldest: 'replays:removeOldest',
    /** Opens a window that owns one replay. Repeat calls open more windows. */
    open: 'replays:open',
    reveal: 'replays:reveal',
    /** Broadcast when a replay is added, bound or deleted, so lists refetch. */
    changed: 'replays:changed',
    /** A replay window asking the main window to show its match. */
    showMatch: 'replays:showMatch'
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
