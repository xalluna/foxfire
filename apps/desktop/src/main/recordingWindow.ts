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
  openWindowAt(windowRoutes.recording(recordingId))
}

/** Somebody's recording that lives only on YouTube, by whose view of which game it is. */
export function openRemoteRecordingWindow(accountId: string, matchId: string): void {
  openWindowAt(windowRoutes.remoteRecording(accountId, matchId))
}

function openWindowAt(route: string): void {
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
  // Only web addresses reach the browser. YouTube's frame opens links of its
  // own — the title, "Watch on YouTube" — and a page that could hand
  // openExternal any scheme it liked could hand it a file or a program.
  window.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadRoute(window, route)

  windows.add(window)
}

export function closeRecordingWindows(): void {
  for (const window of [...windows]) {
    if (!window.isDestroyed()) window.close()
  }
  windows.clear()
}
