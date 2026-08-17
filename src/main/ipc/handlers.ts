import { app, BrowserWindow, ipcMain } from 'electron'
import { CH } from './channels'
import { getSettings, removeApiKey, setAndValidateApiKey } from '../services/settingsService'
import {
  addAccount,
  getAccounts,
  getDashboard,
  getHome,
  removeAccount,
  setHome
} from '../services/accountService'
import { readSyncState, startSync } from '../services/syncService'
import { getAssetManifest } from '../services/ddragonService'
import {
  checkLiveGame,
  getParticipantRank,
  resolveParticipantName
} from '../services/liveGameService'
import { getMasteryData } from '../services/masteryService'
import { getRankHistory } from '../services/rankHistoryService'
import { getBackgroundSettings, setBackgroundSettings } from '../services/backgroundService'
import { getLcuStatus } from '../lcu/watcher'
import { syncTray } from '../tray'
import { searchSummoner } from '../services/searchService'
import { schedulePostGameSync } from '../services/postGameSync'
import { replayAttribution } from '../services/rankAttribution'
import { getDb } from '../db'
import { getAccountById, getHomeAccount, listAccounts } from '../db/repositories/accounts.repo'
import { getChampionStats, getMatchDetail, getMatchSummaries } from '../db/repositories/matches.repo'
import { getTelemetryState, setTelemetryEnabled } from '../telemetry'
import {
  clearTelemetry,
  lcuTelemetry,
  listEndpoints,
  listRequests,
  rateLimitSeries,
  resourceSeries,
  summarise
} from '../telemetry/queries'
import { openTelemetryWindow } from '../telemetryWindow'
import { openLpEditorWindow } from '../lpEditorWindow'
import {
  clearManualRank,
  getEditableMatches,
  saveManualRanks
} from '../services/manualRankService'
import type {
  BackgroundSettings,
  ManualRankEdit,
  QueueType,
  RankRange,
  RiotIdInput
} from '@shared/types'
import type { TelemetryRequestQuery } from '@shared/telemetry'

/**
 * Tells every window that hand-entered LP changed.
 *
 * Broadcast rather than returned, because the window that needs to react is not
 * the one that made the call: the editor is a separate renderer process with
 * its own query cache, and the match list and rank graph it just changed live
 * in the main window. Lives here rather than in manualRankService, which stays
 * free of Electron so it can be tested against an in-memory database.
 */
function broadcastRankEdited(accountId: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.rank.edited, accountId)
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(CH.app.getVersion, () => app.getVersion())

  ipcMain.handle(CH.settings.get, () => getSettings())
  ipcMain.handle(CH.settings.setApiKey, (_e, key: string) => setAndValidateApiKey(key))
  ipcMain.handle(CH.settings.clearApiKey, () => {
    removeApiKey()
    return getSettings()
  })

  ipcMain.handle(CH.accounts.list, () => getAccounts())
  ipcMain.handle(CH.accounts.getHome, () => getHome())
  ipcMain.handle(CH.accounts.add, async (_e, input: RiotIdInput) => {
    const account = await addAccount(input)
    // Kick off the long match backfill without blocking the response, so the
    // UI can navigate to the new account and show progress immediately.
    startSync(account.id)
    return account
  })
  ipcMain.handle(CH.accounts.remove, (_e, accountId: number) => {
    removeAccount(accountId)
    return getAccounts()
  })
  ipcMain.handle(CH.accounts.setHome, (_e, accountId: number) => {
    setHome(accountId)
    return getAccounts()
  })

  ipcMain.handle(CH.dashboard.get, (_e, accountId: number) => getDashboard(accountId))
  ipcMain.handle(
    CH.dashboard.matchList,
    (_e, accountId: number, limit: number, offset: number, queueId: number | null) => {
      const account = getAccountById(getDb(), accountId)
      if (!account) return []
      return getMatchSummaries(getDb(), account.puuid, limit, offset, queueId)
    }
  )
  ipcMain.handle(CH.dashboard.matchDetail, (_e, matchId: string) =>
    getMatchDetail(getDb(), matchId)
  )

  ipcMain.handle(CH.sync.start, (_e, accountId: number) => {
    startSync(accountId)
  })
  ipcMain.handle(CH.sync.getState, (_e, accountId: number) => readSyncState(accountId))

  ipcMain.handle(CH.assets.get, () => getAssetManifest())

  ipcMain.handle(CH.liveGame.check, (_e, accountId: number) => checkLiveGame(accountId))
  ipcMain.handle(CH.liveGame.participantRank, (_e, platform: string, puuid: string) =>
    getParticipantRank(platform, puuid)
  )
  ipcMain.handle(CH.liveGame.participantName, (_e, regionalRoute: string, puuid: string) =>
    resolveParticipantName(regionalRoute, puuid)
  )

  ipcMain.handle(CH.champions.stats, (_e, accountId: number, queueId: number | null) => {
    const account = getAccountById(getDb(), accountId)
    if (!account) return []
    return getChampionStats(getDb(), account.puuid, queueId)
  })

  ipcMain.handle(
    CH.mastery.get,
    (_e, accountId: number, refresh: boolean, queueId: number | null) =>
      getMasteryData(accountId, refresh, queueId)
  )

  ipcMain.handle(
    CH.rank.history,
    (_e, accountId: number, queueType: QueueType, range: RankRange) =>
      getRankHistory(accountId, queueType, range)
  )

  ipcMain.handle(
    CH.rank.editable,
    (_e, accountId: number, queueType: QueueType) => {
      const account = getAccountById(getDb(), accountId)
      if (!account) return []
      return getEditableMatches(getDb(), accountId, account.puuid, queueType)
    }
  )

  // Both writers return the fresh list rather than void: an edit can resolve a
  // neighbouring game on its own, so what the editor should show afterwards is
  // not something it can work out from what it sent.
  ipcMain.handle(
    CH.rank.saveManual,
    (_e, accountId: number, queueType: QueueType, edits: ManualRankEdit[]) => {
      const db = getDb()
      const account = getAccountById(db, accountId)
      if (!account) return []
      saveManualRanks(db, accountId, account.puuid, queueType, edits)
      broadcastRankEdited(accountId)
      return getEditableMatches(db, accountId, account.puuid, queueType)
    }
  )

  ipcMain.handle(
    CH.rank.clearManual,
    (_e, accountId: number, queueType: QueueType, matchId: string) => {
      const db = getDb()
      const account = getAccountById(db, accountId)
      if (!account) return []
      if (clearManualRank(db, accountId, account.puuid, matchId)) broadcastRankEdited(accountId)
      return getEditableMatches(db, accountId, account.puuid, queueType)
    }
  )

  ipcMain.handle(
    CH.rank.openEditor,
    (_e, accountId: number, queueType: QueueType, matchId: string) =>
      openLpEditorWindow(accountId, queueType, matchId)
  )

  ipcMain.handle(CH.lcu.getStatus, () => getLcuStatus())

  ipcMain.handle(CH.background.get, () => getBackgroundSettings())
  ipcMain.handle(CH.background.set, (_e, patch: Partial<BackgroundSettings>) => {
    const next = setBackgroundSettings(patch)
    // Tray visibility is a main-process concern the service deliberately does
    // not reach into, so it is applied here where both are already in scope.
    syncTray()
    return next
  })

  ipcMain.handle(CH.search.summoner, (_e, input: RiotIdInput) => searchSummoner(input))

  ipcMain.handle(CH.telemetry.getState, () => getTelemetryState())
  ipcMain.handle(CH.telemetry.setEnabled, (_e, enabled: boolean) => {
    setTelemetryEnabled(enabled)
    return getTelemetryState()
  })
  ipcMain.handle(CH.telemetry.openWindow, () => openTelemetryWindow())
  ipcMain.handle(CH.telemetry.clear, () => {
    clearTelemetry()
    return getTelemetryState()
  })
  ipcMain.handle(CH.telemetry.requests, (_e, query: TelemetryRequestQuery) => listRequests(query))
  ipcMain.handle(CH.telemetry.endpoints, (_e, windowMs: number) => listEndpoints(windowMs))
  ipcMain.handle(CH.telemetry.summary, (_e, windowMs: number) => summarise(windowMs))
  ipcMain.handle(CH.telemetry.rateLimit, (_e, windowMs: number) => rateLimitSeries(windowMs))
  ipcMain.handle(CH.telemetry.resources, (_e, windowMs: number) => resourceSeries(windowMs))
  ipcMain.handle(CH.telemetry.lcu, (_e, windowMs: number) => lcuTelemetry(windowMs))

  // The same full-history pass the app runs at startup, on demand. Returns how
  // many games it managed to attribute.
  ipcMain.handle(CH.telemetry.replayAttribution, () => {
    const db = getDb()
    let attributed = 0
    for (const account of listAccounts(db)) {
      attributed += replayAttribution(db, account.id, account.puuid)
    }
    return attributed
  })

  // Runs the real post-game schedule, backoff and all, so the timing can be
  // watched in the log without waiting on a game to finish.
  ipcMain.handle(CH.telemetry.simulateGameEnd, () => {
    const account = getHomeAccount(getDb()) ?? listAccounts(getDb())[0]
    if (!account) return false
    schedulePostGameSync(account.id)
    return true
  })
}
