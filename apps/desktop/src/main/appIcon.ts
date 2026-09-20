import { nativeImage, screen, type BrowserWindow } from 'electron'
import type { CaptureStatus, LcuStatus } from '@shared/types'
import { APP_ICON_TOOLTIP, deriveAppIconState, type AppIconState } from './appIconState'
import { OVERLAY_PNG } from './appIconOverlays'

/**
 * Puts what the app is doing on its taskbar button, as a coloured dot drawn
 * over the corner of the icon.
 *
 * The two facts it needs live in different modules — the LCU watcher knows
 * whether a game is on, captureService knows whether OBS is recording it — and
 * both of them already have exactly one place where a change gets out. So they
 * push in here rather than this module pulling from them. That is not only
 * tidier: importing their getters would make a cycle, since they have to import
 * this to push at all.
 *
 * Nothing else in the app imports the window or the tray from here either. The
 * window hands itself over via attachAppIcon, and the tray subscribes — which
 * is the same shape obs/client.ts uses for the one other fan-out in the main
 * process.
 */

/** Seeded with what the two sources start at, so nothing has to push at boot. */
let lcu: LcuStatus = { state: 'disconnected' }
let capture: CaptureStatus = { state: 'off' }

let current: AppIconState = 'none'

/** The main window, or null between its destruction and the next one. */
let target: BrowserWindow | null = null

type Listener = (state: AppIconState) => void
const listeners = new Set<Listener>()

/** Decoding the same PNG on every game is pointless; there are only six. */
const cache = new Map<string, Electron.NativeImage>()

export function getAppIconState(): AppIconState {
  return current
}

/** For the tray, which owns its own handle and only wants to be told. */
export function onAppIconState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAppIconLcu(next: LcuStatus): void {
  lcu = next
  refresh()
}

export function setAppIconCapture(next: CaptureStatus): void {
  capture = next
  refresh()
}

/**
 * Takes ownership of the window the badge is drawn on.
 *
 * Called from createMainWindow rather than from its three callers, so a window
 * rebuilt from the tray or from `activate` cannot be the one that forgot.
 *
 * The 'show' hook is not optional. The window is created with `show: false` and
 * only revealed on ready-to-show, so at the moment this runs there is no
 * taskbar button yet and the shell drops the overlay on the floor. 'show' also
 * covers coming back from the tray, where Windows builds a fresh button with
 * nothing on it.
 */
export function attachAppIcon(window: BrowserWindow): void {
  target = window
  window.on('show', applyOverlay)
  window.on('closed', () => {
    if (target === window) target = null
  })
  applyOverlay()
}

function refresh(): void {
  const next = deriveAppIconState(lcu, capture)
  if (next === current) return
  current = next
  applyOverlay()
  for (const listener of listeners) listener(next)
}

/**
 * Which of the two rendered sizes the shell is about to ask for.
 *
 * Windows draws the overlay at SM_CXSMICON, which tracks the display's scaling.
 * Electron passes only the 1x representation through to the shell, so this has
 * to be chosen rather than left to a multi-scale image. Read per apply, so
 * moving the window to a different monitor is picked up on the next state
 * change — which is close enough for a badge that only changes a few times a
 * game.
 */
function overlaySize(): 16 | 32 {
  const display =
    target && !target.isDestroyed()
      ? screen.getDisplayMatching(target.getBounds())
      : screen.getPrimaryDisplay()
  return display.scaleFactor >= 1.5 ? 32 : 16
}

function overlayImage(state: Exclude<AppIconState, 'none'>): Electron.NativeImage {
  const size = overlaySize()
  const key = `${state}:${size}`
  const cached = cache.get(key)
  if (cached) return cached

  const image = nativeImage.createFromDataURL(`data:image/png;base64,${OVERLAY_PNG[state][size]}`)
  cache.set(key, image)
  return image
}

function applyOverlay(): void {
  // setOverlayIcon is a Windows shell feature. The app is Windows-only in
  // every other respect, but this keeps a dev run elsewhere from finding out
  // the hard way.
  if (process.platform !== 'win32') return

  const window = target
  if (!window || window.isDestroyed()) return

  // Cleared with null rather than skipped: the previous badge outlives a state
  // change otherwise. The description is what a screen reader announces, and
  // an empty one is how you say "no badge" rather than "a badge called ''".
  window.setOverlayIcon(
    current === 'none' ? null : overlayImage(current),
    current === 'none' ? '' : APP_ICON_TOOLTIP[current]
  )
}
