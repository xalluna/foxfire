import { join } from 'path'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { createMainWindow } from './window'
import { closeDatabase, initDatabase } from './db'
import { registerIpcHandlers } from './ipc/handlers'
import { initSettings } from './services/settingsService'
import { getBackgroundSettings, initBackground } from './services/backgroundService'
import { cancelAllPostGameSyncs } from './services/postGameSync'
import { repairAttribution } from './services/rankHistoryService'
import { serverBacked } from './api'
import { startSyncFor } from './api/lcuReporting'
import { bindPendingRecordings } from './services/recordingService'
import { resumeActiveServer } from './services/serverService'
import { rescanReplays, startReplayWatcher, stopReplayWatcher } from './rofl/watcher'
import { stopLcuWatcher } from './lcu/watcher'
import { attachTrayBehaviour, beginQuit, showWindow, syncTray } from './tray'
import { initTelemetry, shutdownTelemetry } from './telemetry'
import { peekTelemetryDb } from './telemetry/db'
import { createLogger, flushLogs, installCrashHandlers } from './telemetry/logger'
import { observeRateLimiter } from './telemetry/limiter'
import { startResourceSampling, stopResourceSampling } from './telemetry/resources'
import { startRetention, stopRetention } from './telemetry/retention'
import { openTelemetryWindow } from './telemetryWindow'
import { registerRecordingProtocol, registerRecordingScheme } from './recordingProtocol'
import { migrateUserData, verifyMigration } from './migrateUserData'
import { initCapture, stopCapture } from './capture/captureService'
import { pinLegacyCaptureFolder } from './services/captureSettings'
import { quitLaunchedObs } from './obs/launch'

/**
 * Opens the telemetry panel without needing the tray, which only exists when
 * the user has opted into running in the background.
 */
const TELEMETRY_ACCELERATOR = 'CommandOrControl+Shift+T'

const log = createLogger('app')

// Pin the data directory so the dev build and the packaged build (whose
// productName would otherwise point at a different folder) share one database
// and one stored API key. Must run before the app is ready.
app.setPath('userData', join(app.getPath('appData'), 'Foxfire'))

// Matches `appId` in electron-builder.yml, which is what NSIS stamps onto the
// installed shortcut. A process that does not claim the same identity is a
// second taskbar button as far as Windows is concerned, separate from the
// pinned one — and the overlay badge would land on whichever of them the user
// happened not to be looking at. Must run before any window exists.
app.setAppUserModelId('com.brandonbarr.foxfire')

// Immediately after the pin and before anything opens a file beneath it: the
// app was called LoL Stats until 0.8.0 and kept its data one directory over.
migrateUserData()

// Before anything else can throw. Warn and error always reach the log file
// regardless of the telemetry setting, so a crash leaves a trace even with
// collection switched off.
installCrashHandlers()

// Must run before the app is ready — Electron will not accept a privileged
// scheme afterwards. See recordingProtocol.ts for why the recording window cannot
// simply point a <video> at a file:// URL.
registerRecordingScheme()

/**
 * One process at a time.
 *
 * Everything durable this app owns is shared: both SQLite databases, the log
 * file, the encrypted API key, and — the one that misbehaves silently — the
 * Riot rate limiter, whose budget is per key rather than per process. A second
 * copy runs a second 20/s queue against the same key and both start collecting
 * 429s, worst of all at launch, where catchUpOnLaunch syncs every account.
 *
 * The lock is keyed on the userData path set just above, so this makes the dev
 * build and the packaged build mutually exclusive too. That is the honest
 * outcome of pinning them to one directory: two of them is precisely the case
 * this prevents.
 *
 * The ready work is registered only on the winner. app.quit() does not cancel
 * an already-registered whenReady callback, so a guard that let it stand would
 * still let the loser open the database and start a sync sweep on its way out.
 */
if (!app.requestSingleInstanceLock()) {
  // warn rather than info: the chattier levels are dropped while telemetry is
  // off, and this line is the only explanation for `npm run dev` appearing to
  // do nothing while the installed app sits in the tray.
  log.warn('Another instance already holds the lock — exiting')
  app.quit()
} else {
  // A launch that loses the lock is the user asking for the window — which in
  // tray mode is hidden, with nothing on screen to suggest the app is already
  // running. No argv to inspect: the app registers no protocol handler and
  // takes no launch arguments.
  app.on('second-instance', () => {
    // Before ready there is no window to raise, and one is already on its way.
    if (!app.isReady()) return
    showWindow()
  })

  app.whenReady().then(bootstrap)
}

function bootstrap(): void {
  initDatabase()
  // After the database, since the enabled flag lives in app_settings, and
  // before anything that might record.
  initTelemetry()
  // Needs safeStorage, which is only usable once the app is ready — so the
  // half of the migration check that reads the key lands here rather than
  // beside the move itself.
  verifyMigration()
  // Before initCapture, and before anything can read the folder back: the
  // default this replaces was never stored, so it has to be written down
  // before the constant behind it changes meaning.
  pinLegacyCaptureFolder()
  observeRateLimiter()
  // Started unconditionally and self-gating: with telemetry off this is a timer
  // that wakes every ten seconds and returns immediately, which is cheaper than
  // the machinery needed to start and stop it as the setting is toggled.
  startResourceSampling()
  startRetention(() => peekTelemetryDb())
  initSettings()
  registerRecordingProtocol()
  registerIpcHandlers()
  globalShortcut.register(TELEMETRY_ACCELERATOR, openTelemetryWindow)
  // After the window exists, so the watcher's status events have somewhere to
  // go on the very first tick.
  attachTrayBehaviour(createMainWindow())
  initBackground()
  // After initBackground, so the LCU watcher it starts already has somewhere to
  // report a game to.
  initCapture()
  syncTray()
  // Before the catch-up, which reads from whichever store owns the accounts:
  // signed in to a server when the app closed means reading from it now, with
  // its push channel open again.
  resumeActiveServer()
  catchUpOnLaunch()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachTrayBehaviour(createMainWindow())
    }
  })
}

/**
 * Catches up on anything played while the app was shut.
 *
 * The gameflow watcher can only see games that finish with the app running, so
 * without this a session played with it closed still needs the button — the
 * exact manual step this work exists to remove. A delta is two requests plus
 * one per genuinely new match, so the cost is proportional to what was actually
 * missed.
 *
 * The attribution repair and the recording binding run first and separately: both
 * touch only SQLite, so neither may sit behind a Riot call that an expired key
 * would fail. Binding especially — an expired key is the reason a recording is
 * still waiting, so making the pairing wait on a working one is backwards.
 *
 * The accounts come from whichever store currently owns them, so connected to a
 * server this sweeps that server's accounts and asks it to do the fetching. The
 * attribution repair stays local because it is about this file: on a server the
 * same pass runs there, at the end of every sync, with no key needed either.
 */
function catchUpOnLaunch(): void {
  repairAttribution()

  void (async () => {
    const accounts = await serverBacked().accounts.list()

    for (const account of accounts) {
      // Each swallowed separately, because a launch must not fail on one
      // account: a recording that could not be paired is paired by the next
      // sync, and an account the server refused is one account rather than the
      // sweep.
      void bindPendingRecordings(account.id).catch(() => undefined)

      // Only accounts this person has claimed. On a server the list is every
      // account anybody tracks, and a sync spends the community's Riot budget
      // on somebody else's history — which the server refuses outright, so
      // sweeping them all meant a 403 per unclaimed account on every launch.
      // Undefined is local-only, where the file is yours and the question
      // does not arise.
      if (account.isMine !== false) void startSyncFor(account.id).catch(() => undefined)
    }
  })().catch(() => undefined)

  // Replays are picked up the same way and for the same reason: the folder
  // watcher only sees files written while the app is running, so a session
  // played with it closed would otherwise leave its replays sitting on disk and
  // invisible. Announced, because on a first run this is the import of an
  // entire replay history and the tab should say so rather than appear to hang.
  void rescanReplays({ announce: true }).then(() => startReplayWatcher())
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

// Registered outside the instance-lock branch, so it also runs on the copy that
// lost the lock and is quitting without ever having booted. Every teardown below
// tolerates that: each one either null-checks its handle or returns early on an
// absent timer. window-all-closed is safe for a different reason — the loser
// never opens a window, so it never fires and never reaches getDb().
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopLcuWatcher()
  stopReplayWatcher()
  stopCapture()
  // Only quits an OBS this app started; one the user was already running,
  // possibly mid-stream, is left alone.
  quitLaunchedObs()
  cancelAllPostGameSyncs()
  stopResourceSampling()
  stopRetention()
  // Before closeDatabase, so the last buffered events are committed while the
  // app is still in a state where writing is legal.
  shutdownTelemetry()
  closeDatabase()
  flushLogs()
})
