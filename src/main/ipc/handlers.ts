import { app, BrowserWindow, dialog, ipcMain } from 'electron'
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
import { getRankByRiotId, getScoreboard } from '../services/liveClientService'
import { getMasteryData } from '../services/masteryService'
import { getRankHistory, getRankPeriods } from '../services/rankHistoryService'
import { rangeBounds } from '@shared/seasons'
import { listSeasons, saveSeasons } from '../db/repositories/seasons.repo'
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
import { openReplayWindow } from '../replayWindow'
import {
  clearObsPassword,
  getCaptureSettings,
  setCaptureSettings,
  setObsPassword
} from '../services/captureSettings'
import { getCaptureStatus, refreshCapture } from '../capture/captureService'
import {
  getDiskUsage,
  getReplayDetail,
  listReplays,
  removeOldestReplays,
  removeReplay,
  revealReplay
} from '../services/replayService'
import { grabSourceScreenshot, readObsConfig } from '../obs/config'
import { validateObs } from '../obs/validate'
import { managedPreviewSource } from '../obs/provision'
import { reconnectObs } from '../obs/client'
import { getMainWindow } from '../window'
import {
  clearManualRank,
  getEditableMatches,
  saveManualRanks
} from '../services/manualRankService'
import type {
  BackgroundSettings,
  CaptureSettings,
  ManualRankEdit,
  QueueType,
  RankRange,
  RiotIdInput,
  SeasonInput
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

  ipcMain.handle(CH.liveClient.scoreboard, (_e, accountId: number) => getScoreboard(accountId))
  ipcMain.handle(
    CH.liveClient.playerRank,
    (_e, platform: string, gameName: string, tagLine: string) =>
      getRankByRiotId(platform, gameName, tagLine)
  )

  ipcMain.handle(
    CH.champions.stats,
    (_e, accountId: number, queueId: number | null, range: RankRange) => {
      const account = getAccountById(getDb(), accountId)
      if (!account) return []
      const { sinceMs, untilMs } = rangeBounds(range, listSeasons(getDb()))
      return getChampionStats(getDb(), account.puuid, queueId, sinceMs, untilMs)
    }
  )

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

  ipcMain.handle(CH.rank.periods, (_e, accountId: number) => getRankPeriods(accountId))

  ipcMain.handle(CH.seasons.list, () => listSeasons(getDb()))
  ipcMain.handle(CH.seasons.save, (_e, seasons: SeasonInput[]) =>
    saveSeasons(getDb(), seasons)
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

  ipcMain.handle(CH.capture.getSettings, () => getCaptureSettings())
  ipcMain.handle(CH.capture.setSettings, (_e, patch: Partial<CaptureSettings>) => {
    const next = setCaptureSettings(patch)
    // Switching capture on has to start OBS and the websocket client, which the
    // settings service deliberately knows nothing about.
    refreshCapture()
    return next
  })
  ipcMain.handle(CH.capture.setObsPassword, (_e, password: string) => {
    const next = setObsPassword(password)
    // The old password is what the live connection authenticated with, so it
    // has to be made again before the new one means anything.
    reconnectObs()
    return next
  })
  ipcMain.handle(CH.capture.clearObsPassword, () => {
    const next = clearObsPassword()
    reconnectObs()
    return next
  })
  ipcMain.handle(CH.capture.chooseFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Where should recordings go?',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getCaptureSettings().folder ?? undefined
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CH.capture.chooseObsPath, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Where is OBS installed?',
      properties: ['openFile'],
      filters: [{ name: 'OBS Studio', extensions: ['exe'] }]
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CH.capture.getStatus, () => getCaptureStatus())
  ipcMain.handle(CH.capture.validate, async () => {
    const settings = getCaptureSettings()
    const managed = settings.mode === 'managed'
    return validateObs(await readObsConfig(managed ? null : settings.obsScene), {
      managed,
      scene: settings.obsScene,
      folder: settings.folder
    })
  })
  // A frame of what would actually be recorded, so setup can be checked by eye
  // rather than by playing a game and finding out afterwards. In managed mode
  // the source only exists once a first recording has provisioned it, and null
  // is a normal answer the settings screen explains.
  ipcMain.handle(CH.capture.preview, async () => {
    const settings = getCaptureSettings()
    const source = settings.mode === 'managed' ? managedPreviewSource() : settings.obsScene
    if (!source) return null
    return grabSourceScreenshot(source)
  })
  ipcMain.handle(CH.capture.reconnect, () => {
    reconnectObs()
    return getCaptureStatus()
  })

  ipcMain.handle(CH.replays.list, (_e, accountId: number) => listReplays(accountId))
  ipcMain.handle(CH.replays.detail, (_e, replayId: number) => getReplayDetail(replayId))
  ipcMain.handle(CH.replays.usage, () => getDiskUsage())
  ipcMain.handle(CH.replays.remove, (_e, replayId: number) => removeReplay(replayId))
  ipcMain.handle(CH.replays.removeOldest, (_e, accountId: number, count: number) =>
    removeOldestReplays(accountId, count)
  )
  ipcMain.handle(CH.replays.open, (_e, replayId: number) => openReplayWindow(replayId))
  ipcMain.handle(CH.replays.reveal, (_e, replayId: number) => revealReplay(replayId))
  // Sent by a replay window, delivered to the main one: the match list it wants
  // opened lives in a different renderer process with its own state.
  ipcMain.handle(CH.replays.showMatch, (_e, accountId: number, matchId: string) => {
    const main = getMainWindow()
    if (!main) return
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    main.webContents.send(CH.replays.showMatch, accountId, matchId)
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
