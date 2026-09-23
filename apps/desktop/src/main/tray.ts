import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { getUpdateState, onUpdateState, restartToUpdate } from './updater/updater'
import { getBackgroundSettings } from './services/backgroundService'
import { createMainWindow, getMainWindow } from './window'
import { openTelemetryWindow } from './telemetryWindow'
import { TRAY_ICON_PNG } from './trayIcon'
import { getAppIconState, onAppIconState } from './appIcon'
import { APP_ICON_TOOLTIP } from './appIconState'
import type { UpdateBlocker } from '@shared/types'

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

/** Drops the update subscription, which rebuilds the menu, with it. */
let untrackUpdates: (() => void) | null = null

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
  tray.setContextMenu(buildMenu())
  tray.on('double-click', showWindow)

  // The one signal left while the window is hidden: hiding to the tray takes
  // the taskbar button with it, and the badge with that.
  untrackAppIcon = onAppIconState((state) => tray?.setToolTip(APP_ICON_TOOLTIP[state]))

  // A menu cannot be edited in place, so every change rebuilds it. That is
  // also how the restart offer greys out when a game starts: the updater
  // announces on the game's state as well as on its own.
  untrackUpdates = onUpdateState(() => tray?.setContextMenu(buildMenu()))
}

/**
 * The tray menu as it stands right now.
 *
 * The update line is here at all because tray mode is where it is most needed:
 * the window is hidden, so the banner offering the restart is not on screen,
 * and this is the only thing that is.
 *
 * It is offered and refused rather than hidden while a game is on. A greyed
 * line that says why is an answer; a line that vanishes is a mystery.
 */
function buildMenu(): Menu {
  const update = getUpdateState()
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'Open Foxfire', click: showWindow },
    // Reachable while the main window is hidden, which is exactly when a
    // background-mode app misbehaves unobserved.
    { label: 'Telemetry', accelerator: 'Ctrl+Shift+T', click: openTelemetryWindow }
  ]

  if (update.status === 'ready' && update.target !== null) {
    items.push({ type: 'separator' }, updateItem(update.target, update.blockedBy))
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        beginQuit()
        app.quit()
      }
    }
  )

  return Menu.buildFromTemplate(items)
}

function updateItem(
  target: string,
  blockedBy: UpdateBlocker | null
): Electron.MenuItemConstructorOptions {
  if (blockedBy === null) {
    return { label: `Restart to update to ${target}`, click: restartToUpdate }
  }

  return {
    label:
      blockedBy === 'recording'
        ? `Foxfire ${target} is ready — after this recording`
        : `Foxfire ${target} is ready — after this game`,
    enabled: false
  }
}

export function destroyTray(): void {
  untrackAppIcon?.()
  untrackAppIcon = null
  untrackUpdates?.()
  untrackUpdates = null
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
