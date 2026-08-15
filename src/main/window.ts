import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { is } from './lib/env'

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

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
