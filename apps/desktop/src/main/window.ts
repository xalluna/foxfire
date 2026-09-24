import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { loadRoute } from './rendererUrl'
import { closeTelemetryWindow } from './telemetryWindow'
import { closeLpEditorWindow } from './lpEditorWindow'
import { closeRecordingWindows } from './recordingWindow'
import { closeArchivesWindow } from './archivesWindow'
import { attachAppIcon } from './appIcon'

/**
 * The app window, tracked by identity.
 *
 * There are now three windows, so "the first one Electron happens to list" is
 * no longer the main one — the tray and second-instance paths would otherwise
 * raise whichever panel was created first.
 */
let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * Builds the app window.
 *
 * `show: false` is for the two launches nobody asked to see: the one Windows
 * makes at login, and the one the installer makes after an update that was
 * started from the tray. The window is built either way — the app is a running
 * process with or without it on screen — it simply never comes forward. Only
 * ever passed in tray mode, where the tray icon is what brings it back.
 */
export function createMainWindow(options: { show?: boolean } = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    // Painted before first paint so the window never flashes white on open.
    backgroundColor: '#010A13',
    // The renderer draws the title bar strip, but Windows keeps drawing the
    // real caption buttons into the overlay region. That preserves snap
    // layouts, double-click-to-maximise and the system menu, none of which a
    // hand-built frameless title bar gets right for free.
    //
    // The renderer must leave --titlebar-controls-w clear on the right; see
    // src/renderer/src/styles/index.css.
    titleBarStyle: 'hidden',
    // --canvas and --accent from src/renderer/src/styles/index.css. Written
    // out because the main process never loads that stylesheet, the same way
    // scripts/make-icon.mjs carries its own copy.
    titleBarOverlay: {
      color: '#010A13',
      symbolColor: '#9DC8FF',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => {
    if (options.show === false) return
    window.show()
  })

  // The telemetry panel, the LP editor and any open recording windows are separate
  // BrowserWindows, so leaving one open would keep `window-all-closed` from ever
  // firing and the app would linger with no visible window outside tray mode. In
  // tray mode this never runs — the close is intercepted and the window only hides.
  window.on('closed', () => {
    mainWindow = null
    closeTelemetryWindow()
    closeLpEditorWindow()
    closeRecordingWindows()
    closeArchivesWindow()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRoute(window, '/')

  mainWindow = window
  // Every path that builds a window comes through here — bootstrap, the tray,
  // and app.activate — so the taskbar badge cannot end up attached to only
  // some of them.
  attachAppIcon(window)
  return window
}
