import { join } from 'path'
import { app, BrowserWindow, globalShortcut } from 'electron'
import { createMainWindow } from './window'
import { closeDatabase, initDatabase } from './db'
import { registerIpcHandlers } from './ipc/handlers'
import { initSettings } from './services/settingsService'
import { HIDDEN_FLAG, getBackgroundSettings, initBackground } from './services/backgroundService'
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
import { registerRecordingProtocol } from './recordingProtocol'
import { YOUTUBE_ENABLED } from '@shared/features'
import { registerPrivilegedSchemes } from './schemes'
import { registerYouTubeHostProtocol } from './youtube/hostProtocol'
import { installYouTubeReferer } from './youtube/referer'
import { reconcileAttachments } from './youtube/attach'
import { initYouTubeQueue, onUploadFinished, stopYouTubeQueue } from './youtube/queue'
import { onServerSyncComplete } from './server/hub'
import { onServerState } from './services/serverService'
import { migrateUserData, verifyMigration } from './migrateUserData'
import { initCapture, stopCapture } from './capture/captureService'
import { pinLegacyCaptureFolder } from './services/captureSettings'
import { quitLaunchedObs } from './obs/launch'
import { takeCompletedInstall, type PendingInstall } from './updater/pending'
import { initUpdater } from './updater/updater'

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
// simply point a <video> at a file:// URL, and shared/youtubeHost.ts for why
// YouTube's player gets an origin of its own.
registerPrivilegedSchemes()

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
  if (YOUTUBE_ENABLED) {
    registerYouTubeHostProtocol()
    installYouTubeReferer()
  }
  registerIpcHandlers()
  globalShortcut.register(TELEMETRY_ACCELERATOR, openTelemetryWindow)
  // Before the window, because it decides whether there is one to look at: an
  // update installed by the copy that just quit brings the app back the way it
  // was left, and the record naming it is cleared by this read.
  //
  // Only in a packaged build. The dev build shares this database — userData is
  // pinned to one directory for both, see the top of this file — and its
  // version is Electron's own, so reading here would clear an installed copy's
  // pending record on the way to not matching it.
  const installed = app.isPackaged ? takeCompletedInstall(app.getVersion()) : null

  // After the window exists, so the watcher's status events have somewhere to
  // go on the very first tick.
  attachTrayBehaviour(createMainWindow({ show: !startsHidden(installed) }))
  initBackground()
  // After initBackground, so the LCU watcher it starts already has somewhere to
  // report a game to.
  initCapture()
  syncTray()
  // After syncTray, so an update that is already downloaded has a tray menu to
  // offer itself from.
  initUpdater(installed)
  // Before the catch-up, which reads from whichever store owns the accounts:
  // signed in to a server when the app closed means reading from it now, with
  // its push channel open again.
  resumeActiveServer()
  catchUpOnLaunch()
  bindAfterServerSyncs()
  if (YOUTUBE_ENABLED) initYouTube()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachTrayBehaviour(createMainWindow())
    }
  })
}

/**
 * Whether this launch should come up as a tray icon and nothing else.
 *
 * Two launches nobody asked to see: the one Windows makes at login, which
 * carries the flag the login item was registered with, and the one the
 * installer makes after an update started from the tray, which carries nothing
 * at all — NSIS relaunches the app with `--updated` and no way to say more, so
 * the copy that asked for the restart wrote down where it was instead.
 *
 * Gated on tray mode in both cases. Without a tray icon a hidden window is an
 * app with nothing on screen and no way back to it.
 */
function startsHidden(installed: PendingInstall | null): boolean {
  if (!getBackgroundSettings().runInTray) return false
  return installed?.relaunchHidden === true || process.argv.includes(HIDDEN_FLAG)
}

/**
 * Connected to a server, a recording can first find its game when the
 * server's sync of that account lands — so that is when to look, rather than
 * at the next launch. Then, with YouTube, tell the server about any video
 * that can now be attached: after the binding, so the pass sees what it bound.
 */
function bindAfterServerSyncs(): void {
  onServerSyncComplete((accountId) => {
    void bindPendingRecordings(accountId)
      .catch(() => 0)
      .then(() => {
        if (YOUTUBE_ENABLED) void reconcileAttachments()
      })
  })
}

/**
 * Recordings on YouTube: the upload queue, and telling the server about them.
 * Only in a build made with the feature — see shared/features.ts.
 *
 * The queue resumes whatever was on its way when the app last quit. A server
 * is told about a recording's video whenever something that decides whether it
 * should be changes — an upload finishing, a server finishing a sync (see
 * bindAfterServerSyncs), and signing in to or switching servers.
 */
function initYouTube(): void {
  initYouTubeQueue()

  onUploadFinished(() => void reconcileAttachments())
  onServerState(() => void reconcileAttachments())

  void reconcileAttachments()
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
    // Only accounts this person has claimed. A sync spends the community's
    // Riot budget, and one on somebody else's history the server refuses
    // outright — sweeping every account on the server once meant a 403 per
    // account nobody here owns, on every launch. Locally, every account in the
    // file is yours. And a recording made on this PC was made on one of yours:
    // the League client watcher only follows accounts this person has claimed.
    const accounts = await serverBacked().accounts.mine()

    for (const account of accounts) {
      // Each swallowed separately, because a launch must not fail on one
      // account: a recording that could not be paired is paired by the next
      // sync, and an account the server refused is one account rather than the
      // sweep.
      void bindPendingRecordings(account.id).catch(() => undefined)
      void startSyncFor(account.id).catch(() => undefined)
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
  // Before the database closes: the chunk in flight is abandoned, and the
  // upload resumes from YouTube's own record of it next launch.
  stopYouTubeQueue()
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
