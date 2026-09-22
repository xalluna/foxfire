import { join } from 'path'
import { BrowserWindow, shell } from 'electron'
import { windowRoutes } from '@shared/windowRoutes'
import { loadRoute } from './rendererUrl'
import { CH } from './ipc/channels'
import type { QueueType } from '@shared/types'

/**
 * The LP editor, in its own window rather than inline in the match list.
 *
 * Fixing one ambiguous game usually means fixing its neighbours: a run of games
 * played with the client closed collapses into a single interval, and stating
 * the rank after two of three splits it into three. A list of the whole
 * unresolved run is the useful shape for that, and it does not fit in a match
 * row — so the right-click that starts the job opens a window showing all of it.
 *
 * Reuses the main renderer bundle at a route of its own, the same arrangement
 * as the telemetry panel, so there is no second Vite entry point to keep in
 * step — see rendererUrl.ts.
 */
let editorWindow: BrowserWindow | null = null

/** What the open window is showing, so a repeat open knows whether to reload. */
let context: { accountId: string; queueType: QueueType } | null = null

export function openLpEditorWindow(
  accountId: string,
  queueType: QueueType,
  matchId: string
): void {
  if (editorWindow && !editorWindow.isDestroyed()) {
    if (editorWindow.isMinimized()) editorWindow.restore()
    editorWindow.show()
    editorWindow.focus()

    if (context && context.accountId === accountId && context.queueType === queueType) {
      // Same list, different row. Nudging it to scroll costs a message;
      // reloading would cost whatever the user had already typed.
      editorWindow.webContents.send(CH.rank.editorFocus, matchId)
    } else {
      context = { accountId, queueType }
      loadEditor(editorWindow, accountId, queueType, matchId)
    }
    return
  }

  const window = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 780,
    minHeight: 520,
    show: false,
    title: 'Foxfire — Edit LP',
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
    editorWindow = null
    context = null
  })
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  loadEditor(window, accountId, queueType, matchId)

  editorWindow = window
  context = { accountId, queueType }
}

function loadEditor(
  window: BrowserWindow,
  accountId: string,
  queueType: QueueType,
  matchId: string
): void {
  loadRoute(window, windowRoutes.lpEditor(accountId, queueType, matchId))
}

export function closeLpEditorWindow(): void {
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.close()
  editorWindow = null
  context = null
}
