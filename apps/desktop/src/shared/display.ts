/**
 * How large the whole interface is drawn: every window, its text and its
 * layout together.
 *
 * Electron's zoom rather than a bigger font. A font size grows the words and
 * leaves the boxes they sit in, so a row that fits at 100% clips at 150%;
 * zoom grows both, and the window's breakpoints move with it, so a narrow
 * column folds the way it would in a narrower window. Steps rather than a
 * slider, because each one is a layout somebody has looked at.
 *
 * Shared by the main process, which applies it and answers the keyboard, and
 * the Display settings page, which offers the same steps.
 */
export const ZOOM_STEPS = [1, 1.1, 1.25, 1.5] as const

export const DEFAULT_ZOOM = 1

export type ZoomDirection = 'in' | 'out' | 'reset'

/**
 * The step nearest a stored factor. Anything unreadable — nothing stored, a
 * value from a build with other steps — comes back as a step rather than as a
 * size nobody chose.
 */
export function nearestZoom(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_ZOOM
  return ZOOM_STEPS.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best))
}

/** One step larger or smaller, stopping at either end; `reset` is 100%. */
export function stepZoom(current: number, direction: ZoomDirection): number {
  if (direction === 'reset') return DEFAULT_ZOOM
  const at = ZOOM_STEPS.indexOf(nearestZoom(current) as (typeof ZOOM_STEPS)[number])
  const next = direction === 'in' ? at + 1 : at - 1
  return ZOOM_STEPS[Math.min(Math.max(next, 0), ZOOM_STEPS.length - 1)]
}

/** What the zoom keys need of a keystroke — Electron's `Input`, structurally. */
export interface ZoomKeyInput {
  type: string
  key: string
  code: string
  control: boolean
  meta: boolean
  alt: boolean
}

/**
 * Which way a keystroke asks to zoom, if it does: Ctrl with =, + or the
 * keypad's plus, with - or the keypad's minus, or with 0 to reset. The
 * browser's own keys, so they do what somebody already expects of them.
 */
export function zoomShortcut(input: ZoomKeyInput): ZoomDirection | null {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null
  if (input.key === '=' || input.key === '+' || input.code === 'Equal' || input.code === 'NumpadAdd') return 'in'
  if (input.key === '-' || input.key === '_' || input.code === 'Minus' || input.code === 'NumpadSubtract') return 'out'
  if (input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0') return 'reset'
  return null
}

/** How a step is written on the settings page. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
