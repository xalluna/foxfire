import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { windowRoutes } from '@shared/windowRoutes'
import { loadRoute } from './rendererUrl'

/**
 * Recording windows, one per open recording — and more than one per recording if asked.
 *
 * Deliberately not the module-singleton shape telemetryWindow.ts and
 * lpEditorWindow.ts use. A window owns a recording here, so several can be open at
 * once: two monitors showing two games, or the same game at two timestamps to
 * compare a botched fight against how it should have gone. Opening the same
 * recording twice is allowed rather than focusing the existing window, because
 * that comparison is a real thing to want.
 *
 * The registry exists so the main window can close them all — leaving one open
 * would keep `window-all-closed` from firing, exactly as it would for the other
 * two panels.
 */
const windows = new Set<BrowserWindow>()

export function openRecordingWindow(recordingId: number): void {
  const window = new BrowserWindow({
    // 16:9 plus room for the header strip and the timeline beneath the video.
    width: 1180,
    height: 800,
    minWidth: 780,
    minHeight: 520,
    show: false,
    title: 'Foxfire — Recording',
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
  window.on('closed', () => windows.delete(window))
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRoute(window, windowRoutes.recording(recordingId))

  windows.add(window)
}

export function closeRecordingWindows(): void {
  for (const window of [...windows]) {
    if (!window.isDestroyed()) window.close()
  }
  windows.clear()
}
