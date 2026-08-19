import { join } from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow, shell } from 'electron'
import { is } from './lib/env'

/**
 * Replay windows, one per open replay — and more than one per replay if asked.
 *
 * Deliberately not the module-singleton shape telemetryWindow.ts and
 * lpEditorWindow.ts use. A window owns a replay here, so several can be open at
 * once: two monitors showing two games, or the same game at two timestamps to
 * compare a botched fight against how it should have gone. Opening the same
 * replay twice is allowed rather than focusing the existing window, because
 * that comparison is a real thing to want.
 *
 * The registry exists so the main window can close them all — leaving one open
 * would keep `window-all-closed` from firing, exactly as it would for the other
 * two panels.
 */
const windows = new Set<BrowserWindow>()

function replayHash(replayId: number): string {
  return `#replay?id=${replayId}`
}

export function openReplayWindow(replayId: number): void {
  const window = new BrowserWindow({
    // 16:9 plus room for the header strip and the timeline beneath the video.
    width: 1180,
    height: 800,
    minWidth: 780,
    minHeight: 520,
    show: false,
    title: 'Foxfire — Replay',
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

  const hash = replayHash(replayId)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
  } else {
    // Built by hand rather than through loadFile, whose hash goes through
    // url.format and mangles the '?' and '=' this one carries — the same
    // reason lpEditorWindow.ts does it this way.
    window.loadURL(pathToFileURL(join(__dirname, '../renderer/index.html')).href + hash)
  }

  windows.add(window)
}

export function closeReplayWindows(): void {
  for (const window of [...windows]) {
    if (!window.isDestroyed()) window.close()
  }
  windows.clear()
}
