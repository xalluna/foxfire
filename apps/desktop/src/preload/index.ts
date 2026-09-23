import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/api'
import type {
  ArchiveCopyProgress,
  CaptureStatus,
  LcuStatus,
  ReplayImportProgress,
  ServerState,
  SyncProgressEvent,
  ImportProgress,
  UpdateState
} from '@shared/types'
import { CH } from '../main/ipc/channels'

// The renderer never touches the Riot API or SQLite directly — everything
// crosses this bridge.
const api: Api = {
  app: {
    getVersion: () => ipcRenderer.invoke(CH.app.getVersion)
  },
  updates: {
    getState: () => ipcRenderer.invoke(CH.updates.getState),
    check: () => ipcRenderer.invoke(CH.updates.check),
    restart: () => ipcRenderer.invoke(CH.updates.restart),
    dismissNote: () => ipcRenderer.invoke(CH.updates.dismissNote),
    onChanged: (cb) => {
      const handler = (_e: IpcRendererEvent, state: UpdateState): void => cb(state)
      ipcRenderer.on(CH.updates.changed, handler)
      return () => ipcRenderer.removeListener(CH.updates.changed, handler)
    }
  },
  server: {
    getState: () => ipcRenderer.invoke(CH.server.getState),
    probe: (url) => ipcRenderer.invoke(CH.server.probe, url),
    previewInvite: (url, token) => ipcRenderer.invoke(CH.server.previewInvite, url, token),
    register: (url, registration) => ipcRenderer.invoke(CH.server.register, url, registration),
    login: (url, credentials) => ipcRenderer.invoke(CH.server.login, url, credentials),
    logout: () => ipcRenderer.invoke(CH.server.logout),
    changePassword: (change) => ipcRenderer.invoke(CH.server.changePassword, change),
    changeEmail: (change) => ipcRenderer.invoke(CH.server.changeEmail, change),
    changeUsername: (username) => ipcRenderer.invoke(CH.server.changeUsername, username),
    setActive: (url) => ipcRenderer.invoke(CH.server.setActive, url),
    forget: (url) => ipcRenderer.invoke(CH.server.forget, url),
    onChanged: (cb) => {
      const handler = (_e: IpcRendererEvent, state: ServerState): void => cb(state)
      ipcRenderer.on(CH.server.changed, handler)
      return () => ipcRenderer.removeListener(CH.server.changed, handler)
    }
  },
  serverAdmin: {
    users: () => ipcRenderer.invoke(CH.serverAdmin.users),
    updateUser: (id, patch) => ipcRenderer.invoke(CH.serverAdmin.updateUser, id, patch),
    deleteUser: (id) => ipcRenderer.invoke(CH.serverAdmin.deleteUser, id),
    createPasswordReset: (userId) => ipcRenderer.invoke(CH.serverAdmin.createPasswordReset, userId),
    revokePasswordReset: (userId) => ipcRenderer.invoke(CH.serverAdmin.revokePasswordReset, userId),
    invites: () => ipcRenderer.invoke(CH.serverAdmin.invites),
    createInvite: (email) => ipcRenderer.invoke(CH.serverAdmin.createInvite, email),
    revokeInvite: (id) => ipcRenderer.invoke(CH.serverAdmin.revokeInvite, id),
    getSettings: () => ipcRenderer.invoke(CH.serverAdmin.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(CH.serverAdmin.setSettings, patch),
    storage: () => ipcRenderer.invoke(CH.serverAdmin.storage),
    storedReplays: () => ipcRenderer.invoke(CH.serverAdmin.storedReplays),
    removeReplay: (matchId) => ipcRenderer.invoke(CH.serverAdmin.removeReplay, matchId),
    forceUnlink: (riotAccountId) => ipcRenderer.invoke(CH.serverAdmin.forceUnlink, riotAccountId),
    chooseDatabase: () => ipcRenderer.invoke(CH.serverAdmin.chooseDatabase),
    importDatabase: (filePath) => ipcRenderer.invoke(CH.serverAdmin.importDatabase, filePath),
    onImportProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, progress: ImportProgress): void => cb(progress)
      ipcRenderer.on(CH.serverAdmin.importProgress, listener)
      return () => ipcRenderer.removeListener(CH.serverAdmin.importProgress, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.settings.get),
    setApiKey: (key) => ipcRenderer.invoke(CH.settings.setApiKey, key),
    clearApiKey: () => ipcRenderer.invoke(CH.settings.clearApiKey),
    setKeyType: (keyType, limits) => ipcRenderer.invoke(CH.settings.setKeyType, keyType, limits),
    onKeyInvalid: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(CH.settings.keyInvalid, listener)
      return () => ipcRenderer.removeListener(CH.settings.keyInvalid, listener)
    }
  },
  accounts: {
    list: () => ipcRenderer.invoke(CH.accounts.list),
    getHome: () => ipcRenderer.invoke(CH.accounts.getHome),
    add: (input) => ipcRenderer.invoke(CH.accounts.add, input),
    link: (input) => ipcRenderer.invoke(CH.accounts.link, input),
    remove: (accountId) => ipcRenderer.invoke(CH.accounts.remove, accountId),
    setHome: (accountId) => ipcRenderer.invoke(CH.accounts.setHome, accountId)
  },
  dashboard: {
    get: (accountId) => ipcRenderer.invoke(CH.dashboard.get, accountId),
    matchList: (accountId, limit, offset, queueId) =>
      ipcRenderer.invoke(CH.dashboard.matchList, accountId, limit, offset, queueId),
    matchDetail: (matchId) => ipcRenderer.invoke(CH.dashboard.matchDetail, matchId)
  },
  sync: {
    start: (accountId) => ipcRenderer.invoke(CH.sync.start, accountId),
    getState: (accountId) => ipcRenderer.invoke(CH.sync.getState, accountId),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, event: SyncProgressEvent): void => cb(event)
      ipcRenderer.on(CH.sync.progress, listener)
      return () => ipcRenderer.removeListener(CH.sync.progress, listener)
    }
  },
  assets: {
    get: () => ipcRenderer.invoke(CH.assets.get)
  },
  liveClient: {
    scoreboard: (accountId) => ipcRenderer.invoke(CH.liveClient.scoreboard, accountId)
  },
  champions: {
    stats: (accountId, queueId, range) =>
      ipcRenderer.invoke(CH.champions.stats, accountId, queueId, range)
  },
  seasons: {
    list: () => ipcRenderer.invoke(CH.seasons.list),
    save: (seasons) => ipcRenderer.invoke(CH.seasons.save, seasons)
  },
  mastery: {
    get: (accountId, refresh, queueId) =>
      ipcRenderer.invoke(CH.mastery.get, accountId, refresh, queueId)
  },
  rank: {
    history: (accountId, queueType, range) =>
      ipcRenderer.invoke(CH.rank.history, accountId, queueType, range),
    periods: (accountId) => ipcRenderer.invoke(CH.rank.periods, accountId),
    editable: (accountId, queueType) =>
      ipcRenderer.invoke(CH.rank.editable, accountId, queueType),
    saveManual: (accountId, queueType, edits) =>
      ipcRenderer.invoke(CH.rank.saveManual, accountId, queueType, edits),
    clearManual: (accountId, queueType, matchId) =>
      ipcRenderer.invoke(CH.rank.clearManual, accountId, queueType, matchId),
    openEditor: (accountId, queueType, matchId) =>
      ipcRenderer.invoke(CH.rank.openEditor, accountId, queueType, matchId),
    onEdited: (cb) => {
      const listener = (_e: IpcRendererEvent, accountId: string): void => cb(accountId)
      ipcRenderer.on(CH.rank.edited, listener)
      return () => ipcRenderer.removeListener(CH.rank.edited, listener)
    },
    onEditorFocus: (cb) => {
      const listener = (_e: IpcRendererEvent, matchId: string): void => cb(matchId)
      ipcRenderer.on(CH.rank.editorFocus, listener)
      return () => ipcRenderer.removeListener(CH.rank.editorFocus, listener)
    }
  },
  lcu: {
    getStatus: () => ipcRenderer.invoke(CH.lcu.getStatus),
    onStatus: (cb) => {
      const listener = (_e: IpcRendererEvent, status: LcuStatus): void => cb(status)
      ipcRenderer.on(CH.lcu.status, listener)
      return () => ipcRenderer.removeListener(CH.lcu.status, listener)
    },
    onRankChanged: (cb) => {
      const listener = (_e: IpcRendererEvent, accountId: string): void => cb(accountId)
      ipcRenderer.on(CH.lcu.rankChanged, listener)
      return () => ipcRenderer.removeListener(CH.lcu.rankChanged, listener)
    }
  },
  background: {
    get: () => ipcRenderer.invoke(CH.background.get),
    set: (patch) => ipcRenderer.invoke(CH.background.set, patch)
  },
  capture: {
    getSettings: () => ipcRenderer.invoke(CH.capture.getSettings),
    set: (patch) => ipcRenderer.invoke(CH.capture.setSettings, patch),
    setObsPassword: (password) => ipcRenderer.invoke(CH.capture.setObsPassword, password),
    clearObsPassword: () => ipcRenderer.invoke(CH.capture.clearObsPassword),
    chooseFolder: () => ipcRenderer.invoke(CH.capture.chooseFolder),
    chooseObsPath: () => ipcRenderer.invoke(CH.capture.chooseObsPath),
    getStatus: () => ipcRenderer.invoke(CH.capture.getStatus),
    onStatus: (cb) => {
      const listener = (_e: IpcRendererEvent, status: CaptureStatus): void => cb(status)
      ipcRenderer.on(CH.capture.status, listener)
      return () => ipcRenderer.removeListener(CH.capture.status, listener)
    },
    validate: () => ipcRenderer.invoke(CH.capture.validate),
    preview: () => ipcRenderer.invoke(CH.capture.preview),
    reconnect: () => ipcRenderer.invoke(CH.capture.reconnect)
  },
  recordings: {
    list: (accountId) => ipcRenderer.invoke(CH.recordings.list, accountId),
    detail: (recordingId) => ipcRenderer.invoke(CH.recordings.detail, recordingId),
    usage: () => ipcRenderer.invoke(CH.recordings.usage),
    remove: (recordingId) => ipcRenderer.invoke(CH.recordings.remove, recordingId),
    removeOldest: (accountId, count) =>
      ipcRenderer.invoke(CH.recordings.removeOldest, accountId, count),
    open: (recordingId) => ipcRenderer.invoke(CH.recordings.open, recordingId),
    reveal: (recordingId) => ipcRenderer.invoke(CH.recordings.reveal, recordingId),
    onChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(CH.recordings.changed, listener)
      return () => ipcRenderer.removeListener(CH.recordings.changed, listener)
    },
    showMatch: (accountId, matchId) =>
      ipcRenderer.invoke(CH.recordings.showMatch, accountId, matchId),
    onShowMatch: (cb) => {
      const listener = (_e: IpcRendererEvent, accountId: string, matchId: string): void =>
        cb(accountId, matchId)
      ipcRenderer.on(CH.recordings.showMatch, listener)
      return () => ipcRenderer.removeListener(CH.recordings.showMatch, listener)
    }
  },
  // Synchronous and local: webUtils reads the path off a File the user already
  // handed us, with no main-process round trip.
  pathForFile: (file) => {
    try {
      const path = webUtils.getPathForFile(file)
      return path === '' ? null : path
    } catch {
      return null
    }
  },
  replays: {
    list: (accountId) => ipcRenderer.invoke(CH.replays.list, accountId),
    usage: (accountId) => ipcRenderer.invoke(CH.replays.usage, accountId),
    open: (replayId) => ipcRenderer.invoke(CH.replays.open, replayId),
    reveal: (replayId) => ipcRenderer.invoke(CH.replays.reveal, replayId),
    remove: (replayId) => ipcRenderer.invoke(CH.replays.remove, replayId),
    add: (filePath) => ipcRenderer.invoke(CH.replays.add, filePath),
    link: (replayId, matchId) => ipcRenderer.invoke(CH.replays.link, replayId, matchId),
    download: (matchId) => ipcRenderer.invoke(CH.replays.download, matchId),
    rescan: () => ipcRenderer.invoke(CH.replays.rescan),
    settings: () => ipcRenderer.invoke(CH.replays.settings),
    setSettings: (patch) => ipcRenderer.invoke(CH.replays.setSettings, patch),
    chooseSourceFolder: () => ipcRenderer.invoke(CH.replays.chooseSourceFolder),
    onChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(CH.replays.changed, listener)
      return () => ipcRenderer.removeListener(CH.replays.changed, listener)
    },
    onImportProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, progress: ReplayImportProgress): void => cb(progress)
      ipcRenderer.on(CH.replays.importProgress, listener)
      return () => ipcRenderer.removeListener(CH.replays.importProgress, listener)
    }
  },
  archives: {
    list: () => ipcRenderer.invoke(CH.archives.list),
    add: (path, label) => ipcRenderer.invoke(CH.archives.add, path, label),
    remove: (id) => ipcRenderer.invoke(CH.archives.remove, id),
    setPatch: (id, patch) => ipcRenderer.invoke(CH.archives.setPatch, id, patch),
    live: () => ipcRenderer.invoke(CH.archives.live),
    choosePath: () => ipcRenderer.invoke(CH.archives.choosePath),
    archiveLive: (destination) => ipcRenderer.invoke(CH.archives.archiveLive, destination),
    cancelCopy: () => ipcRenderer.invoke(CH.archives.cancelCopy),
    onCopyProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, progress: ArchiveCopyProgress): void => cb(progress)
      ipcRenderer.on(CH.archives.copyProgress, listener)
      return () => ipcRenderer.removeListener(CH.archives.copyProgress, listener)
    },
    openWindow: () => ipcRenderer.invoke(CH.archives.openWindow)
  },
  search: {
    summoner: (input) => ipcRenderer.invoke(CH.search.summoner, input)
  },
  telemetry: {
    getState: () => ipcRenderer.invoke(CH.telemetry.getState),
    setEnabled: (enabled) => ipcRenderer.invoke(CH.telemetry.setEnabled, enabled),
    openWindow: () => ipcRenderer.invoke(CH.telemetry.openWindow),
    clear: () => ipcRenderer.invoke(CH.telemetry.clear),
    requests: (query) => ipcRenderer.invoke(CH.telemetry.requests, query),
    endpoints: (windowMs) => ipcRenderer.invoke(CH.telemetry.endpoints, windowMs),
    summary: (windowMs) => ipcRenderer.invoke(CH.telemetry.summary, windowMs),
    rateLimit: (windowMs) => ipcRenderer.invoke(CH.telemetry.rateLimit, windowMs),
    resources: (windowMs) => ipcRenderer.invoke(CH.telemetry.resources, windowMs),
    lcu: (windowMs) => ipcRenderer.invoke(CH.telemetry.lcu, windowMs),
    replayAttribution: () => ipcRenderer.invoke(CH.telemetry.replayAttribution),
    simulateGameEnd: () => ipcRenderer.invoke(CH.telemetry.simulateGameEnd)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback for contextIsolation disabled (not used in this app, kept for safety)
  window.api = api
}
