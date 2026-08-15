// Shared channel names — imported by both the main-process handlers and the
// preload bridge so the two sides can't drift apart.
export const CH = {
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
  liveGame: {
    check: 'liveGame:check',
    participantRank: 'liveGame:participantRank',
    participantName: 'liveGame:participantName'
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
    history: 'rank:history'
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
    lcu: 'telemetry:lcu'
  }
} as const
