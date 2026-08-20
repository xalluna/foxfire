import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from './lib/env'
import { closeTelemetryWindow } from './telemetryWindow'
import { closeLpEditorWindow } from './lpEditorWindow'
import { closeRecordingWindows } from './recordingWindow'
import { closeArchivesWindow } from './archivesWindow'

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

export function createMainWindow(): BrowserWindow {
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
    titleBarOverlay: {
      color: '#010A13',
      symbolColor: '#C8AA6E',
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window
  return window
}
