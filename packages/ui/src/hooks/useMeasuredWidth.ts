import { useLayoutEffect, useState } from 'react'

/**
 * The width a chart is shown at, so it can draw at 1:1.
 *
 * A chart drawn into a fixed viewBox and stretched to its box scales its text
 * along with it: 9px labels came out at 4px on a phone and as headings across
 * a wide window. Measured, a label is the size it says it is, wherever the
 * chart sits.
 *
 * `fallback` is what it draws at before the first measurement, and what a copy
 * in a hidden column — which measures 0 — goes on drawing at. The ref is a
 * callback rather than an object, so a chart that swaps its empty state for
 * the drawing is measured again rather than left watching the element it threw
 * away.
 */
export function useMeasuredWidth(fallback: number): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry.contentRect.width)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, width]
}
