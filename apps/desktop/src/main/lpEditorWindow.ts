import { join } from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow, shell } from 'electron'
import { is } from './lib/env'
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
 * Reuses the main renderer bundle and selects itself with a URL hash, the same
 * arrangement as the telemetry panel, so there is no second Vite entry point to
 * keep in step — see main.tsx.
 */
let editorWindow: BrowserWindow | null = null

/** What the open window is showing, so a repeat open knows whether to reload. */
let context: { accountId: number; queueType: QueueType } | null = null

function editorHash(accountId: number, queueType: QueueType, matchId: string): string {
  return `#lp-editor?account=${accountId}&queue=${queueType}&match=${encodeURIComponent(matchId)}`
}

export function openLpEditorWindow(
  accountId: number,
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
  accountId: number,
  queueType: QueueType,
  matchId: string
): void {
  const hash = editorHash(accountId, queueType, matchId)
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
  } else {
    // loadFile would do this itself, but it routes the hash through url.format,
    // and this one carries '?', '&' and '=' rather than the bare word the
    // telemetry window passes. Building the file URL here keeps the escaping
    // out of the question.
    window.loadURL(pathToFileURL(join(__dirname, '../renderer/index.html')).href + hash)
  }
}

export function closeLpEditorWindow(): void {
  if (editorWindow && !editorWindow.isDestroyed()) editorWindow.close()
  editorWindow = null
  context = null
}
