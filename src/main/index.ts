import { join } from 'path'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { createMainWindow } from './window'
import { closeDatabase, getDb, initDatabase } from './db'
import { listAccounts } from './db/repositories/accounts.repo'
import { registerIpcHandlers } from './ipc/handlers'
import { initSettings } from './services/settingsService'
import { getBackgroundSettings, initBackground } from './services/backgroundService'
import { cancelAllPostGameSyncs } from './services/postGameSync'
import { repairAttribution } from './services/rankHistoryService'
import { startSync } from './services/syncService'
import { stopLcuWatcher } from './lcu/watcher'
import { attachTrayBehaviour, beginQuit, syncTray } from './tray'
import { initTelemetry, shutdownTelemetry } from './telemetry'
import { peekTelemetryDb } from './telemetry/db'
import { flushLogs, installCrashHandlers } from './telemetry/logger'
import { observeRateLimiter } from './telemetry/limiter'
import { startResourceSampling, stopResourceSampling } from './telemetry/resources'
import { startRetention, stopRetention } from './telemetry/retention'
import { openTelemetryWindow } from './telemetryWindow'

/**
 * Opens the telemetry panel without needing the tray, which only exists when
 * the user has opted into running in the background.
 */
const TELEMETRY_ACCELERATOR = 'CommandOrControl+Shift+T'

// Pin the data directory so the dev build and the packaged build (whose
// productName would otherwise point at a different folder) share one database
// and one stored API key. Must run before the app is ready.
app.setPath('userData', join(app.getPath('appData'), 'my-op-gg'))

// Before anything else can throw. Warn and error always reach the log file
// regardless of the telemetry setting, so a crash leaves a trace even with
// collection switched off.
installCrashHandlers()

app.whenReady().then(() => {
  initDatabase()
  // After the database, since the enabled flag lives in app_settings, and
  // before anything that might record.
  initTelemetry()
  observeRateLimiter()
  // Started unconditionally and self-gating: with telemetry off this is a timer
  // that wakes every ten seconds and returns immediately, which is cheaper than
  // the machinery needed to start and stop it as the setting is toggled.
  startResourceSampling()
  startRetention(() => peekTelemetryDb())
  initSettings()
  registerIpcHandlers()
  globalShortcut.register(TELEMETRY_ACCELERATOR, openTelemetryWindow)
  // After the window exists, so the watcher's status events have somewhere to
  // go on the very first tick.
  attachTrayBehaviour(createMainWindow())
  initBackground()
  syncTray()
  catchUpOnLaunch()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachTrayBehaviour(createMainWindow())
    }
  })
})

/**
 * Catches up on anything played while the app was shut.
 *
 * The gameflow watcher can only see games that finish with the app running, so
 * without this a session played with it closed still needs the button — the
 * exact manual step this work exists to remove. A delta is two requests plus
 * one per genuinely new match, so the cost is proportional to what was actually
 * missed.
 *
 * The attribution repair runs first and separately: it touches only SQLite, so
 * it must not sit behind a Riot call that an expired key would fail.
 */
function catchUpOnLaunch(): void {
  repairAttribution()
  for (const account of listAccounts(getDb())) {
    startSync(account.id, 'auto')
  }
}

app.on('window-all-closed', () => {
  // In tray mode the window closing is not the end of the session — the LCU
  // watcher keeps recording rank, which is the entire point of running in the
  // background. Quit is then only reachable from the tray menu.
  if (process.platform !== 'darwin' && !hasTrayWindowsHidden()) {
    app.quit()
  }
})

/** True when the app is meant to outlive its window. */
function hasTrayWindowsHidden(): boolean {
  return getBackgroundSettings().runInTray
}

app.on('before-quit', () => {
  beginQuit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopLcuWatcher()
  cancelAllPostGameSyncs()
  stopResourceSampling()
  stopRetention()
  // Before closeDatabase, so the last buffered events are committed while the
  // app is still in a state where writing is legal.
  shutdownTelemetry()
  closeDatabase()
  flushLogs()
})
