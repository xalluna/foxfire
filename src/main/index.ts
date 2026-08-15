import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { closeDatabase, initDatabase } from './db'
import { registerIpcHandlers } from './ipc/handlers'
import { initSettings } from './services/settingsService'
import { getBackgroundSettings, initBackground } from './services/backgroundService'
import { stopLcuWatcher } from './lcu/watcher'
import { attachTrayBehaviour, beginQuit, syncTray } from './tray'

// Pin the data directory so the dev build and the packaged build (whose
// productName would otherwise point at a different folder) share one database
// and one stored API key. Must run before the app is ready.
app.setPath('userData', join(app.getPath('appData'), 'my-op-gg'))

app.whenReady().then(() => {
  initDatabase()
  initSettings()
  registerIpcHandlers()
  // After the window exists, so the watcher's status events have somewhere to
  // go on the very first tick.
  attachTrayBehaviour(createMainWindow())
  initBackground()
  syncTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachTrayBehaviour(createMainWindow())
    }
  })
})

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
  stopLcuWatcher()
  closeDatabase()
})
