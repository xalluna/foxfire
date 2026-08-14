import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { Api } from '@shared/api'
import type { SyncProgressEvent } from '@shared/types'
import { CH } from '../main/ipc/channels'

// The renderer never touches the Riot API or SQLite directly — everything
// crosses this bridge.
const api: Api = {
  settings: {
    get: () => ipcRenderer.invoke(CH.settings.get),
    setApiKey: (key) => ipcRenderer.invoke(CH.settings.setApiKey, key),
    clearApiKey: () => ipcRenderer.invoke(CH.settings.clearApiKey),
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
    matchList: (accountId, limit, offset) =>
      ipcRenderer.invoke(CH.dashboard.matchList, accountId, limit, offset),
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
  liveGame: {
    check: (accountId) => ipcRenderer.invoke(CH.liveGame.check, accountId),
    participantRank: (platform, puuid) =>
      ipcRenderer.invoke(CH.liveGame.participantRank, platform, puuid),
    participantName: (regionalRoute, puuid) =>
      ipcRenderer.invoke(CH.liveGame.participantName, regionalRoute, puuid)
  },
  mastery: {
    get: (accountId, refresh) => ipcRenderer.invoke(CH.mastery.get, accountId, refresh)
  },
  search: {
    summoner: (input) => ipcRenderer.invoke(CH.search.summoner, input)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback for contextIsolation disabled (not used in this app, kept for safety)
  window.api = api
}
