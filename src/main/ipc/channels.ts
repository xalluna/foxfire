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
