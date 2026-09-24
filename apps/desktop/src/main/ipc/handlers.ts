import { app, dialog, ipcMain } from 'electron'
import { CH } from './channels'
import { getSettings, removeApiKey, setAndValidateApiKey, setKeyType } from '../services/settingsService'
import { getAssetManifest } from '../services/ddragonService'
import {
  changeEmail,
  changePassword,
  changeUsername,
  forgetServer,
  getServerState,
  login as serverLogin,
  logout as serverLogout,
  previewInvite,
  probe as serverProbe,
  register as serverRegister,
  setActiveServer
} from '../services/serverService'
import {
  createInvite,
  createPasswordReset,
  deleteUser,
  addRiotAccount,
  forceUnlink,
  getStorageUsage,
  listStoredReplays,
  removeStoredReplay,
  getSettings as getServerAdminSettings,
  listOpenInvites,
  listUsedInvites,
  listUsers,
  revokeInvite,
  revokePasswordReset,
  setSettings as setServerAdminSettings,
  updateUser
} from '../services/serverAdminService'
import { chooseImportDatabase, importDatabase } from '../services/importService'
import { getBackgroundSettings, setBackgroundSettings } from '../services/backgroundService'
import { getLcuStatus } from '../lcu/watcher'
import { syncTray } from '../tray'
import {
  checkForUpdates,
  dismissInstalledNote,
  getUpdateState,
  restartToUpdate
} from '../updater/updater'
import {
  addReplayByPath,
  getReplayUsage,
  linkReplayToMatch,
  listReplays,
  openReplay,
  downloadSharedReplay,
  removeReplay,
  revealReplay,
  scanReplayFolder
} from '../services/replayService'
import { getRoflSettings, setRoflSettings } from '../services/roflSettings'
import {
  addArchive,
  archiveLiveClient,
  cancelArchiveCopy,
  forgetLiveClient,
  getRoflSettingsWithClient,
  listClientArchives,
  removeArchive,
  resolveLiveClient,
  setArchivePatchByHand
} from '../services/clientArchiveService'
import { openArchivesWindow } from '../archivesWindow'
import { schedulePostGameSync } from '../services/postGameSync'
import { replayAttribution } from '../services/rankAttribution'
import { getDb } from '../db'
import { serverBacked } from '../api'
import { getHomeAccount, listAccounts } from '../db/repositories/accounts.repo'
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
import { openRecordingWindow } from '../recordingWindow'
import { YOUTUBE_ENABLED } from '@shared/features'
import { registerYouTubeHandlers } from './youtubeHandlers'
import {
  clearObsPassword,
  getCaptureSettings,
  setCaptureSettings,
  setObsPassword
} from '../services/captureSettings'
import { getCaptureStatus, refreshCapture } from '../capture/captureService'
import {
  forgetRecording,
  getDiskUsage,
  getRecordingDetail,
  listRecordings,
  removeOldestRecordings,
  removeRecording,
  revealRecording
} from '../services/recordingService'
import { grabSourceScreenshot, readObsConfig } from '../obs/config'
import { validateObs } from '../obs/validate'
import { managedPreviewSource } from '../obs/provision'
import { reconnectObs } from '../obs/client'
import { getMainWindow } from '../window'
import type {
  AdminUserPatch,
  AdminUserQuery,
  BackgroundSettings,
  CaptureSettings,
  EmailChange,
  ManualRankEdit,
  PageOptions,
  PasswordChange,
  PlayerSearchOptions,
  PlayerSearchResult,
  QueueType,
  RankRange,
  RiotIdInput,
  RiotKeyLimits,
  RiotKeyType,
  RoflSettings,
  ServerAdminSettings,
  ServerCredentials,
  ServerRegistration,
  SeasonInput
} from '@shared/types'
import type { TelemetryRequestQuery } from '@shared/telemetry'

/**
 * Wires every channel to something that answers it.
 *
 * The bodies used to live here. The ones whose answers come from the shared
 * store now sit behind serverBacked(), which is the single place that decides
 * whether that store is this machine's SQLite or a Foxfire Server — see
 * src/main/api/types.ts for where that line falls and why.
 *
 * What is left inline is what only this process can do: native dialogs, opening
 * windows, the League client, OBS, and the local disk.
 *
 * serverBacked() is called per handler rather than captured once, because these
 * register at startup and the answer can change while the app is running.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(CH.app.getVersion, () => app.getVersion())

  ipcMain.handle(CH.updates.getState, () => getUpdateState())
  ipcMain.handle(CH.updates.check, () => checkForUpdates())
  ipcMain.handle(CH.updates.restart, () => restartToUpdate())
  ipcMain.handle(CH.updates.dismissNote, () => dismissInstalledNote())

  ipcMain.handle(CH.server.getState, () => getServerState())
  ipcMain.handle(CH.server.probe, (_e, url: string) => serverProbe(url))
  ipcMain.handle(CH.server.previewInvite, (_e, url: string, token: string) =>
    previewInvite(url, token)
  )
  ipcMain.handle(CH.server.register, (_e, url: string, registration: ServerRegistration) =>
    serverRegister(url, registration)
  )
  ipcMain.handle(CH.server.login, (_e, url: string, credentials: ServerCredentials) =>
    serverLogin(url, credentials)
  )
  ipcMain.handle(CH.server.logout, () => serverLogout())
  ipcMain.handle(CH.server.changePassword, (_e, change: PasswordChange) => changePassword(change))
  ipcMain.handle(CH.server.changeEmail, (_e, change: EmailChange) => changeEmail(change))
  ipcMain.handle(CH.server.changeUsername, (_e, username: string) => changeUsername(username))
  ipcMain.handle(CH.server.setActive, (_e, url: string | null) => setActiveServer(url))
  ipcMain.handle(CH.server.forget, (_e, url: string) => forgetServer(url))

  ipcMain.handle(CH.serverAdmin.users, (_e, query?: AdminUserQuery) => listUsers(query))
  ipcMain.handle(CH.serverAdmin.updateUser, (_e, id: string, patch: AdminUserPatch) =>
    updateUser(id, patch)
  )
  ipcMain.handle(CH.serverAdmin.deleteUser, (_e, id: string) => deleteUser(id))
  ipcMain.handle(CH.serverAdmin.createPasswordReset, (_e, userId: string) =>
    createPasswordReset(userId)
  )
  ipcMain.handle(CH.serverAdmin.revokePasswordReset, (_e, userId: string) =>
    revokePasswordReset(userId)
  )
  ipcMain.handle(CH.serverAdmin.openInvites, () => listOpenInvites())
  ipcMain.handle(CH.serverAdmin.usedInvites, (_e, page?: PageOptions) => listUsedInvites(page))
  ipcMain.handle(CH.serverAdmin.createInvite, (_e, email: string) => createInvite(email))
  ipcMain.handle(CH.serverAdmin.revokeInvite, (_e, id: string) => revokeInvite(id))
  ipcMain.handle(CH.serverAdmin.getSettings, () => getServerAdminSettings())
  ipcMain.handle(CH.serverAdmin.storage, () => getStorageUsage())
  ipcMain.handle(CH.serverAdmin.storedReplays, (_e, page?: PageOptions) => listStoredReplays(page))
  ipcMain.handle(CH.serverAdmin.removeReplay, (_e, matchId: string) => removeStoredReplay(matchId))
  ipcMain.handle(CH.serverAdmin.forceUnlink, (_e, id: string) => forceUnlink(id))
  ipcMain.handle(CH.serverAdmin.addRiotAccount, (_e, input: RiotIdInput) => addRiotAccount(input))
  ipcMain.handle(CH.serverAdmin.chooseDatabase, () => chooseImportDatabase())
  ipcMain.handle(CH.serverAdmin.importDatabase, (_e, filePath: string) => importDatabase(filePath))
  ipcMain.handle(CH.serverAdmin.setSettings, (_e, patch: Partial<ServerAdminSettings>) =>
    setServerAdminSettings(patch)
  )

  ipcMain.handle(CH.settings.get, () => getSettings())
  ipcMain.handle(CH.settings.setApiKey, (_e, key: string) => setAndValidateApiKey(key))
  ipcMain.handle(CH.settings.setKeyType, (_e, keyType: RiotKeyType, limits?: RiotKeyLimits) =>
    setKeyType(keyType, limits)
  )
  ipcMain.handle(CH.settings.clearApiKey, () => {
    removeApiKey()
    return getSettings()
  })

  ipcMain.handle(CH.accounts.mine, () => serverBacked().accounts.mine())
  ipcMain.handle(CH.accounts.get, (_e, accountId: string) => serverBacked().accounts.get(accountId))
  ipcMain.handle(CH.accounts.find, (_e, riotId: RiotIdInput) => serverBacked().accounts.find(riotId))
  ipcMain.handle(CH.accounts.getHome, () => serverBacked().accounts.getHome())
  ipcMain.handle(CH.accounts.add, (_e, input: RiotIdInput) => serverBacked().accounts.add(input))
  ipcMain.handle(CH.accounts.link, (_e, input: RiotIdInput) => serverBacked().accounts.link(input))
  ipcMain.handle(CH.accounts.remove, (_e, accountId: string) =>
    serverBacked().accounts.remove(accountId)
  )
  ipcMain.handle(CH.accounts.setHome, (_e, accountId: string) =>
    serverBacked().accounts.setHome(accountId)
  )

  ipcMain.handle(CH.dashboard.get, (_e, accountId: string) =>
    serverBacked().dashboard.get(accountId)
  )
  ipcMain.handle(
    CH.dashboard.matchList,
    (_e, accountId: string, limit: number, offset: number, queueId: number | null) =>
      serverBacked().dashboard.matchList(accountId, limit, offset, queueId)
  )
  ipcMain.handle(CH.dashboard.matchDetail, (_e, matchId: string) =>
    serverBacked().dashboard.matchDetail(matchId)
  )
  ipcMain.handle(CH.dashboard.matchSummary, (_e, accountId: string, matchId: string) =>
    serverBacked().dashboard.matchSummary?.(accountId, matchId) ?? null
  )

  ipcMain.handle(CH.sync.start, (_e, accountId: string) => serverBacked().sync.start(accountId))
  ipcMain.handle(CH.sync.getState, (_e, accountId: string) =>
    serverBacked().sync.getState(accountId)
  )

  ipcMain.handle(CH.assets.get, () => getAssetManifest())

  ipcMain.handle(
    CH.champions.stats,
    (_e, accountId: string, queueId: number | null, range: RankRange) =>
      serverBacked().champions.stats(accountId, queueId, range)
  )

  ipcMain.handle(
    CH.mastery.get,
    (_e, accountId: string, refresh: boolean, queueId: number | null) =>
      serverBacked().mastery.get(accountId, refresh, queueId)
  )

  ipcMain.handle(
    CH.rank.history,
    (_e, accountId: string, queueType: QueueType, range: RankRange) =>
      serverBacked().rank.history(accountId, queueType, range)
  )

  ipcMain.handle(CH.rank.trend, (_e, accountId: string, queueType: QueueType) =>
    serverBacked().rank.trend(accountId, queueType)
  )

  ipcMain.handle(CH.rank.periods, (_e, accountId: string) =>
    serverBacked().rank.periods(accountId)
  )

  ipcMain.handle(CH.seasons.list, () => serverBacked().seasons.list())
  ipcMain.handle(CH.seasons.save, (_e, seasons: SeasonInput[]) =>
    serverBacked().seasons.save(seasons)
  )

  ipcMain.handle(CH.rank.editable, (_e, accountId: string, queueType: QueueType) =>
    serverBacked().rank.editable(accountId, queueType)
  )
  ipcMain.handle(
    CH.rank.saveManual,
    (_e, accountId: string, queueType: QueueType, edits: ManualRankEdit[]) =>
      serverBacked().rank.saveManual(accountId, queueType, edits)
  )
  ipcMain.handle(
    CH.rank.clearManual,
    (_e, accountId: string, queueType: QueueType, matchId: string) =>
      serverBacked().rank.clearManual(accountId, queueType, matchId)
  )

  ipcMain.handle(
    CH.rank.openEditor,
    (_e, accountId: string, queueType: QueueType, matchId: string) =>
      openLpEditorWindow(accountId, queueType, matchId)
  )

  ipcMain.handle(CH.lcu.getStatus, () => getLcuStatus())

  ipcMain.handle(CH.background.get, () => getBackgroundSettings())
  ipcMain.handle(CH.background.set, (_e, patch: Partial<BackgroundSettings>) => {
    const next = setBackgroundSettings(patch)
    // Tray visibility is a main-process concern the service deliberately does
    // not reach into, so it is applied here where both are already in scope.
    syncTray()
    // The League install path doubles as the replay runner, and its patch is
    // cached for a minute — drop that now rather than making the user wait for
    // it to expire after pointing Foxfire somewhere new.
    if (patch.lcuInstallPath !== undefined) forgetLiveClient()
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

  ipcMain.handle(CH.recordings.list, (_e, accountId: string, page?: PageOptions) => listRecordings(accountId, page))
  ipcMain.handle(CH.recordings.detail, (_e, recordingId: number) => getRecordingDetail(recordingId))
  ipcMain.handle(CH.recordings.usage, () => getDiskUsage())
  ipcMain.handle(CH.recordings.remove, (_e, recordingId: number) => removeRecording(recordingId))
  ipcMain.handle(CH.recordings.removeOldest, (_e, accountId: string, count: number) =>
    removeOldestRecordings(accountId, count)
  )
  ipcMain.handle(CH.recordings.open, (_e, recordingId: number) => openRecordingWindow(recordingId))
  ipcMain.handle(CH.recordings.reveal, (_e, recordingId: number) => revealRecording(recordingId))
  ipcMain.handle(CH.recordings.forget, (_e, recordingId: number) => forgetRecording(recordingId))

  // YouTube, and a server's recordings, only in a build made with them. Without,
  // nothing answers those channels — and nothing in the renderer asks.
  if (YOUTUBE_ENABLED) registerYouTubeHandlers()

  /* Riot's own replays. No detail handler and no window: the League client is
     the player, and Foxfire only ever hands it a path. */
  ipcMain.handle(CH.replays.list, (_e, accountId: string, page?: PageOptions) => listReplays(accountId, page))
  ipcMain.handle(CH.replays.usage, (_e, accountId: string) => getReplayUsage(accountId))
  ipcMain.handle(CH.replays.open, (_e, replayId: number) => openReplay(replayId))
  ipcMain.handle(CH.replays.reveal, (_e, replayId: number) => revealReplay(replayId))
  ipcMain.handle(CH.replays.remove, (_e, replayId: number) => removeReplay(replayId))
  ipcMain.handle(CH.replays.download, (_e, matchId: string) => downloadSharedReplay(matchId))
  ipcMain.handle(CH.replays.add, (_e, filePath: string) => addReplayByPath(filePath))
  ipcMain.handle(CH.replays.link, (_e, replayId: number, matchId: string) =>
    linkReplayToMatch(replayId, matchId)
  )
  ipcMain.handle(CH.replays.rescan, () => scanReplayFolder({ announce: true }))
  // The settings read asks the client where its replay folder is, so it is the
  // async one; the write does not need to and stays synchronous.
  ipcMain.handle(CH.replays.settings, () => getRoflSettingsWithClient())
  ipcMain.handle(CH.replays.setSettings, (_e, patch: Partial<RoflSettings>) => {
    setRoflSettings(patch)
    return getRoflSettingsWithClient()
  })
  ipcMain.handle(CH.replays.chooseSourceFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Where does League save replays?',
      properties: ['openDirectory'],
      defaultPath: getRoflSettings().sourceFolder ?? undefined
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  /* League installs kept so older replays stay watchable. */
  ipcMain.handle(CH.archives.list, () => listClientArchives())
  ipcMain.handle(CH.archives.add, (_e, path: string, label: string | null) => addArchive(path, label))
  ipcMain.handle(CH.archives.remove, (_e, id: number) => removeArchive(id))
  ipcMain.handle(CH.archives.setPatch, (_e, id: number, patch: string) =>
    setArchivePatchByHand(id, patch)
  )
  ipcMain.handle(CH.archives.live, () => resolveLiveClient())
  ipcMain.handle(CH.archives.choosePath, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Where is the League install?',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CH.archives.archiveLive, (_e, destination: string) => archiveLiveClient(destination))
  ipcMain.handle(CH.archives.cancelCopy, () => cancelArchiveCopy())
  ipcMain.handle(CH.archives.openWindow, () => openArchivesWindow())

  // Sent by a recording window, delivered to the main one: the match list it wants
  // opened lives in a different renderer process with its own state.
  ipcMain.handle(CH.recordings.showMatch, (_e, accountId: string, matchId: string) => {
    const main = getMainWindow()
    if (!main) return
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    main.webContents.send(CH.recordings.showMatch, accountId, matchId)
  })

  ipcMain.handle(CH.search.players, (_e, query: string, options?: PlayerSearchOptions) =>
    serverBacked().search.players(query, options)
  )

  ipcMain.handle(CH.favorites.list, () => serverBacked().favorites.list())
  ipcMain.handle(CH.favorites.add, (_e, player: PlayerSearchResult) => serverBacked().favorites.add(player))
  ipcMain.handle(CH.favorites.remove, (_e, accountId: string) => serverBacked().favorites.remove(accountId))
  ipcMain.handle(CH.favorites.refresh, (_e, seen: PlayerSearchResult[]) => serverBacked().favorites.refresh(seen))

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
