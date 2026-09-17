import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from './lib/env'

/**
 * The developer telemetry panel, in its own window rather than a tab in the app.
 *
 * Keeping it out of the main window matters for more than tidiness: Electron
 * gives a second BrowserWindow its own renderer process, so the panel's own
 * rendering never shows up in the CPU and memory figures it is displaying. A
 * tab would have measured itself.
 *
 * It reuses the main renderer bundle and selects itself with a URL hash, so
 * there is no second Vite entry point to keep in step — see main.tsx.
 */
let telemetryWindow: BrowserWindow | null = null

export function openTelemetryWindow(): void {
  if (telemetryWindow && !telemetryWindow.isDestroyed()) {
    if (telemetryWindow.isMinimized()) telemetryWindow.restore()
    telemetryWindow.show()
    telemetryWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Foxfire — Telemetry',
    autoHideMenuBar: true,
    backgroundColor: '#010A13',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    telemetryWindow = null
  })
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#telemetry`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'telemetry' })
  }

  telemetryWindow = window
}

export function closeTelemetryWindow(): void {
  if (telemetryWindow && !telemetryWindow.isDestroyed()) telemetryWindow.close()
  telemetryWindow = null
}

/**
 * Drives the resource sampler's cadence: there is no point sampling at 1Hz for
 * nobody. Also read by the app's quit logic, since an open panel would
 * otherwise keep `window-all-closed` from ever firing.
 */
export function isTelemetryWindowOpen(): boolean {
  return telemetryWindow !== null && !telemetryWindow.isDestroyed()
}
