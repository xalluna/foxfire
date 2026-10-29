import type { FocusEvent, KeyboardEvent } from 'react'

/**
 * A chart's reading, moved by the keyboard rather than the pointer. The
 * arithmetic sits apart from the markup so it can be tested without a DOM.
 */

/**
 * Which reading a key moves the cursor to, over `count` of them.
 *
 * Undefined for a key the chart leaves alone, so it goes on to whatever else
 * listens. From no reading, an arrow comes in from the far side — right starts
 * at the first, left at the latest — and neither wraps: a chart is a timeline,
 * and stepping past today onto the first day of the month would be a jump
 * nobody asked for. Up and down do what right and left do, as on any slider.
 * Escape puts the cursor away, and is left alone when there is none, so it can
 * still close the window the chart is in.
 */
export function stepCursor(key: string, index: number | null, count: number): number | null | undefined {
  if (count === 0) return undefined
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return index === null ? count - 1 : Math.max(0, index - 1)
    case 'ArrowRight':
    case 'ArrowUp':
      return index === null ? 0 : Math.min(count - 1, index + 1)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    case 'Escape':
      return index === null ? undefined : null
    default:
      return undefined
  }
}

/**
 * What makes a chart readable from the keyboard: focusable, stepped through
 * with the arrow keys, and drawing the same reading the pointer would.
 *
 * A slider rather than an image, because that is what it is to somebody who
 * cannot see it — a position along the time axis, and what stands there. A
 * screen reader keeps the arrow keys for itself over an image and hands them
 * on over a slider, and it reads `aria-valuetext` out whenever it changes.
 * With nothing under the cursor the value is the latest reading, which is the
 * one the card around the chart names; a keyboard landing on the chart draws
 * it too, so what is heard and what is shown agree. A click leaves it alone,
 * so the pointer's own reading is not taken from under it.
 */
export function chartCursorProps(
  count: number,
  index: number | null,
  setIndex: (index: number | null) => void,
  describe: (index: number) => string
): {
  role: 'slider'
  tabIndex: 0
  'aria-valuemin': number
  'aria-valuemax': number
  'aria-valuenow': number
  'aria-valuetext': string
  onKeyDown: (event: KeyboardEvent) => void
  onFocus: (event: FocusEvent<Element>) => void
  onBlur: () => void
} {
  const shown = index ?? count - 1
  return {
    role: 'slider',
    tabIndex: 0,
    'aria-valuemin': 0,
    'aria-valuemax': count - 1,
    'aria-valuenow': shown,
    'aria-valuetext': describe(shown),
    onKeyDown: (event) => {
      const next = stepCursor(event.key, index, count)
      if (next === undefined) return
      event.preventDefault()
      setIndex(next)
    },
    onFocus: (event) => {
      if (index === null && event.currentTarget.matches(':focus-visible')) setIndex(count - 1)
    },
    onBlur: () => setIndex(null)
  }
}
