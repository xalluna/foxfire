import type { BrowserWindow } from 'electron'
import { CH } from './ipc/channels'
import { broadcast } from './ipc/broadcast'
import { getDisplaySettings, setDisplaySettings } from './services/displayService'
import { stepZoom, zoomShortcut, type ZoomDirection } from '@shared/display'
import type { DisplaySettings } from '@shared/types'

/**
 * The renderer's title strip, in CSS pixels — --titlebar-h in
 * src/renderer/src/styles/index.css. Zoom grows the strip with everything
 * else, but Windows draws the caption buttons into an overlay of its own at a
 * height in screen pixels, so the overlay is told the zoomed height to stay
 * level with the strip.
 */
const TITLE_BAR_HEIGHT = 40

/** Every window drawn at the stored size: the app's own, never the hidden capture page. */
const windows = new Set<BrowserWindow>()
let titleBarWindow: BrowserWindow | null = null

export function currentZoom(): number {
  return getDisplaySettings().zoom
}

/** The caption-button overlay's height at a zoom. */
export function titleBarHeight(zoom = currentZoom()): number {
  return Math.round(TITLE_BAR_HEIGHT * zoom)
}

/**
 * Draws a window at the stored size and lets it change the size.
 *
 * Every window is created with the stored factor as its `zoomFactor`, and this
 * re-applies it after each load, because a reload starts a page again at
 * whatever Chromium remembered rather than at what was chosen. Ctrl+=, Ctrl+-
 * and Ctrl+0 are taken here, before Electron's default menu sees them: its
 * zoom moves the one page and forgets it at the next restart, where these move
 * every window and are remembered. Ctrl+wheel does the same.
 */
export function attachZoom(window: BrowserWindow, options: { titleBar?: boolean } = {}): void {
  windows.add(window)
  if (options.titleBar) titleBarWindow = window
  window.on('closed', () => {
    windows.delete(window)
    if (titleBarWindow === window) titleBarWindow = null
  })

  const contents = window.webContents
  contents.on('did-finish-load', () => contents.setZoomFactor(currentZoom()))
  contents.on('before-input-event', (event, input) => {
    const direction = zoomShortcut(input)
    if (direction === null) return
    event.preventDefault()
    changeZoom(direction)
  })
  contents.on('zoom-changed', (_event, direction) => changeZoom(direction))
}

/** Saves a size, draws every window at it, and tells every window it moved. */
export function setZoom(zoom: number): DisplaySettings {
  const next = setDisplaySettings({ zoom })
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.setZoomFactor(next.zoom)
  }
  if (titleBarWindow && !titleBarWindow.isDestroyed()) {
    titleBarWindow.setTitleBarOverlay({ height: titleBarHeight(next.zoom) })
  }
  broadcast(CH.display.changed, next)
  return next
}

function changeZoom(direction: ZoomDirection): void {
  const zoom = stepZoom(currentZoom(), direction)
  if (zoom !== currentZoom() || direction === 'reset') setZoom(zoom)
}
