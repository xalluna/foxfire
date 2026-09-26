// Shared channel names — imported by both the main-process handlers and the
// preload bridge so the two sides can't drift apart.
export const CH = {
  app: {
    getVersion: 'app:getVersion'
  },
  // Keeping this copy current. `changed` is pushed on every move the updater
  // makes, because the window and the tray both draw from it and must not be
  // able to disagree about whether an update is waiting.
  updates: {
    getState: 'updates:getState',
    check: 'updates:check',
    restart: 'updates:restart',
    dismissNote: 'updates:dismissNote',
    changed: 'updates:changed'
  },
  // Joining, leaving and switching Foxfire servers. Separate from `settings`,
  // which is the Riot API key and its limits: that is configuration for
  // local-only mode, and connected to a server this machine holds no key at
  // all. The two are asked about at different times by different screens.
  server: {
    getState: 'server:getState',
    probe: 'server:probe',
    previewInvite: 'server:previewInvite',
    register: 'server:register',
    login: 'server:login',
    logout: 'server:logout',
    changePassword: 'server:changePassword',
    changeEmail: 'server:changeEmail',
    changeUsername: 'server:changeUsername',
    setActive: 'server:setActive',
    forget: 'server:forget',
    changed: 'server:changed'
  },
  // Administering the active server. Its own domain rather than a corner of
  // `server`, because none of it is about the connection: these are calls a
  // member with the right role can make, and the server decides that on every
  // one of them.
  serverAdmin: {
    users: 'serverAdmin:users',
    updateUser: 'serverAdmin:updateUser',
    deleteUser: 'serverAdmin:deleteUser',
    createPasswordReset: 'serverAdmin:createPasswordReset',
    revokePasswordReset: 'serverAdmin:revokePasswordReset',
    openInvites: 'serverAdmin:openInvites',
    usedInvites: 'serverAdmin:usedInvites',
    createInvite: 'serverAdmin:createInvite',
    revokeInvite: 'serverAdmin:revokeInvite',
    getSettings: 'serverAdmin:getSettings',
    setSettings: 'serverAdmin:setSettings',
    storage: 'serverAdmin:storage',
    storedReplays: 'serverAdmin:storedReplays',
    removeReplay: 'serverAdmin:removeReplay',
    forceUnlink: 'serverAdmin:forceUnlink',
    addRiotAccount: 'serverAdmin:addRiotAccount',
    insights: 'serverAdmin:insights',
    serverLogs: 'serverAdmin:serverLogs',
    chooseDatabase: 'serverAdmin:chooseDatabase',
    importDatabase: 'serverAdmin:importDatabase',
    importProgress: 'serverAdmin:importProgress'
  },
  settings: {
    get: 'settings:get',
    setApiKey: 'settings:setApiKey',
    clearApiKey: 'settings:clearApiKey',
    setKeyType: 'settings:setKeyType',
    keyInvalid: 'settings:keyInvalid'
  },
  accounts: {
    mine: 'accounts:mine',
    get: 'accounts:get',
    find: 'accounts:find',
    getHome: 'accounts:getHome',
    add: 'accounts:add',
    link: 'accounts:link',
    remove: 'accounts:remove',
    setHome: 'accounts:setHome'
  },
  dashboard: {
    get: 'dashboard:get',
    matchList: 'dashboard:matchList',
    matchDetail: 'dashboard:matchDetail',
    /** One game as one player's row — the header over a recording that has no file here. */
    matchSummary: 'dashboard:matchSummary'
  },
  // The recordings a server holds on YouTube, one per game per account. Named
  // apart from `recordings`, which are this disk's files: a server's copy can
  // be somebody else's, and can outlive the file it came from.
  matchRecordings: {
    get: 'matchRecordings:get',
    attach: 'matchRecordings:attach',
    detach: 'matchRecordings:detach',
    /** Pushed from the server's hub when one is attached, replaced or removed. */
    changed: 'matchRecordings:changed'
  },
  sync: {
    start: 'sync:start',
    getState: 'sync:getState',
    progress: 'sync:progress'
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
    /** The profile's graph: thirty days, a close a day. */
    trend: 'rank:trend',
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
    showMatch: 'recordings:showMatch',
    /** Removes a recording's row once its file is gone. Never touches YouTube or a server. */
    forget: 'recordings:forget',
    /** Opens a window for a recording this machine has no file of, from YouTube. */
    openRemote: 'recordings:openRemote',
    /** Every recording that can go to YouTube, whole, for "select all". YouTube builds only. */
    eligible: 'recordings:eligible'
  },
  // Putting recordings on YouTube. The Google connection lives in the main
  // process — its refresh token never crosses IPC — and the renderer only ever
  // sees whether there is one and whose it is.
  youtube: {
    getState: 'youtube:getState',
    connect: 'youtube:connect',
    cancelConnect: 'youtube:cancelConnect',
    disconnect: 'youtube:disconnect',
    getSettings: 'youtube:getSettings',
    setSettings: 'youtube:setSettings',
    /** The upload form's starting point for one recording, from the templates. */
    draft: 'youtube:draft',
    enqueue: 'youtube:enqueue',
    /** Many recordings at once, titled from the template, with one privacy for all. */
    enqueueMany: 'youtube:enqueueMany',
    cancel: 'youtube:cancel',
    retry: 'youtube:retry',
    /** Attaches a hand-uploaded video to a recording on this disk, markers and all. */
    attachLink: 'youtube:attachLink',
    /** Tells the active server about a recording's video again, replacing what is there. */
    reattach: 'youtube:reattach',
    /** Pushed when the connection or the queue changes. */
    changed: 'youtube:changed'
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
    download: 'replays:download',
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
    players: 'search:players'
  },
  favorites: {
    list: 'favorites:list',
    add: 'favorites:add',
    remove: 'favorites:remove',
    refresh: 'favorites:refresh'
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
