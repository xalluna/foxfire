import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { getBackgroundSettings } from './services/backgroundService'
import { createMainWindow, getMainWindow } from './window'
import { openTelemetryWindow } from './telemetryWindow'
import { TRAY_ICON_PNG } from './trayIcon'
import { getAppIconState, onAppIconState } from './appIcon'
import { APP_ICON_TOOLTIP } from './appIconState'

/**
 * Keeps the app alive after the window closes, which is what makes per-game LP
 * tracking possible: rank can only be read from the League client while this
 * process is running, and games are played with the window closed.
 *
 * Only engaged when the user opts into tray mode. With it off, closing the
 * window quits as before and the league-v4 backstop covers what was missed.
 */
let tray: Tray | null = null

/** Distinguishes a real quit from a close that should hide to the tray. */
let quitting = false

/** Drops the tooltip subscription when the tray goes away. */
let untrackAppIcon: (() => void) | null = null

export function isQuitting(): boolean {
  return quitting
}

export function beginQuit(): void {
  quitting = true
}

/**
 * Brings the app back to the front, from the tray menu or from a second launch
 * that the instance lock turned away.
 *
 * The recreated window gets the tray behaviour attached like any other, or
 * closing it would quit the app outright while tray mode is on.
 */
export function showWindow(): void {
  const existing = getMainWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }
  attachTrayBehaviour(createMainWindow())
}

/**
 * The 16x16 mark, inlined as base64 by scripts/make-icon.mjs.
 *
 * Embedded rather than loaded from disk because the tray is created in the
 * main process, whose bundle has no asset pipeline — a file path would resolve
 * differently in dev and inside the packaged asar, and an icon that fails to
 * load leaves an invisible tray item the user cannot find.
 *
 * Generated rather than pasted, so it cannot fall out of step with the .ico and
 * the in-app logo the way the old hand-maintained blob could.
 */
function trayIcon(): Electron.NativeImage {
  return nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG}`)
}

export function ensureTray(): void {
  if (tray) return

  tray = new Tray(trayIcon())
  // Read rather than assumed: the tray can be switched on from settings
  // mid-game, and syncTray runs after capture has already reported.
  tray.setToolTip(APP_ICON_TOOLTIP[getAppIconState()])
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Foxfire', click: showWindow },
      // Reachable while the main window is hidden, which is exactly when a
      // background-mode app misbehaves unobserved.
      { label: 'Telemetry', accelerator: 'Ctrl+Shift+T', click: openTelemetryWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          beginQuit()
          app.quit()
        }
      }
    ])
  )
  tray.on('double-click', showWindow)

  // The one signal left while the window is hidden: hiding to the tray takes
  // the taskbar button with it, and the badge with that.
  untrackAppIcon = onAppIconState((state) => tray?.setToolTip(APP_ICON_TOOLTIP[state]))
}

export function destroyTray(): void {
  untrackAppIcon?.()
  untrackAppIcon = null
  tray?.destroy()
  tray = null
}

/**
 * Intercepts the window's close button so it hides instead of quitting.
 *
 * Attached per window rather than once globally, because the window is
 * recreated when reopened from the tray.
 */
export function attachTrayBehaviour(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (quitting || !getBackgroundSettings().runInTray) return
    event.preventDefault()
    window.hide()
  })
}

/** Adds or removes the tray icon to match the current preference. */
export function syncTray(): void {
  if (getBackgroundSettings().runInTray) ensureTray()
  else destroyTray()
}
