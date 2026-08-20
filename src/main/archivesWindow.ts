import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from './lib/env'

/**
 * Managing archived League installs, in a window of its own.
 *
 * This is a filing job, not a setting: a table of installs, their patches, and
 * a copy that runs for a quarter of an hour while reporting progress. None of
 * that fits inside a collapsible Settings fold, and burying a long-running copy
 * behind a disclosure triangle would hide exactly the thing the user needs to
 * watch.
 *
 * A singleton, like the telemetry panel — there is one register and no reason
 * to look at it twice at once. It reuses the main renderer bundle and picks
 * itself out with a URL hash, so there is no second Vite entry to keep in step.
 */
let archivesWindow: BrowserWindow | null = null

export function openArchivesWindow(): void {
  if (archivesWindow && !archivesWindow.isDestroyed()) {
    if (archivesWindow.isMinimized()) archivesWindow.restore()
    archivesWindow.show()
    archivesWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Foxfire — Archived clients',
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
    archivesWindow = null
  })
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#archives`)
  } else {
    // A plain hash with no query, so loadFile is safe here — unlike the LP
    // editor and recording windows, which carry parameters that url.format
    // mangles.
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'archives' })
  }

  archivesWindow = window
}

export function closeArchivesWindow(): void {
  if (archivesWindow && !archivesWindow.isDestroyed()) archivesWindow.close()
  archivesWindow = null
}
