import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/api'
import type { CaptureStatus, LcuStatus, SyncProgressEvent } from '@shared/types'
import { CH } from '../main/ipc/channels'

// The renderer never touches the Riot API or SQLite directly — everything
// crosses this bridge.
const api: Api = {
  app: {
    getVersion: () => ipcRenderer.invoke(CH.app.getVersion)
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
    scoreboard: (accountId) => ipcRenderer.invoke(CH.liveClient.scoreboard, accountId),
    playerRank: (platform, gameName, tagLine) =>
      ipcRenderer.invoke(CH.liveClient.playerRank, platform, gameName, tagLine)
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
      const listener = (_e: IpcRendererEvent, accountId: number): void => cb(accountId)
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
      const listener = (_e: IpcRendererEvent, accountId: number): void => cb(accountId)
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
  replays: {
    list: (accountId) => ipcRenderer.invoke(CH.replays.list, accountId),
    detail: (replayId) => ipcRenderer.invoke(CH.replays.detail, replayId),
    usage: () => ipcRenderer.invoke(CH.replays.usage),
    remove: (replayId) => ipcRenderer.invoke(CH.replays.remove, replayId),
    removeOldest: (accountId, count) =>
      ipcRenderer.invoke(CH.replays.removeOldest, accountId, count),
    open: (replayId) => ipcRenderer.invoke(CH.replays.open, replayId),
    reveal: (replayId) => ipcRenderer.invoke(CH.replays.reveal, replayId),
    onChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(CH.replays.changed, listener)
      return () => ipcRenderer.removeListener(CH.replays.changed, listener)
    },
    showMatch: (accountId, matchId) =>
      ipcRenderer.invoke(CH.replays.showMatch, accountId, matchId),
    onShowMatch: (cb) => {
      const listener = (_e: IpcRendererEvent, accountId: number, matchId: string): void =>
        cb(accountId, matchId)
      ipcRenderer.on(CH.replays.showMatch, listener)
      return () => ipcRenderer.removeListener(CH.replays.showMatch, listener)
    }
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
