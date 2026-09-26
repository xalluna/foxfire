import type { InsightSeries, InsightsFrame, InsightsSection, InsightsWindow } from '../types'

/** A span the insights page offers, as its picker lists it. */
export interface InsightsWindowOption {
  key: InsightsWindow
  label: string
}

/**
 * The spans, shortest first — the same seven the server knows
 * (Foxfire.Core/InsightWindows.cs), which refuses any other.
 */
export const INSIGHTS_WINDOWS: readonly InsightsWindowOption[] = [
  { key: '15m', label: '15 min' },
  { key: '1h', label: '1 hour' },
  { key: '6h', label: '6 hours' },
  { key: '24h', label: '24 hours' },
  { key: '48h', label: '48 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }
]

/** The page's chart tabs, which the server answers one route each. */
export const INSIGHTS_SECTIONS: readonly InsightsSection[] = ['overview', 'requests', 'riot', 'sync', 'runtime']

export function isInsightsSection(value: unknown): value is InsightsSection {
  return INSIGHTS_SECTIONS.some((s) => s === value)
}

/** Where the page opens: long enough to show a shape, short enough to be about now. */
export const DEFAULT_INSIGHTS_WINDOW: InsightsWindow = '1h'

export function isInsightsWindow(value: unknown): value is InsightsWindow {
  return INSIGHTS_WINDOWS.some((w) => w.key === value)
}

/**
 * How often an open page asks again.
 *
 * As often as the window's newest point can change and no more: fifteen
 * minutes is ten-second points, so five seconds keeps it live; an hour or six
 * is minutes, and a day or a month moves too slowly for anything but a minute
 * to be worth the request.
 */
export function insightsPollMs(window: InsightsWindow): number {
  switch (window) {
    case '15m':
      return 5_000
    case '1h':
    case '6h':
      return 30_000
    default:
      return 60_000
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * A point's time, as a chart labels it for this window, in local time.
 *
 * Only as precise as the points are: seconds for fifteen minutes, the clock
 * inside a day, and the day as well from a day up — a day's two ends are the
 * same time on the clock, and a week of "14:00"s would say nothing about which
 * afternoon.
 */
export function formatInsightTime(at: number, window: InsightsWindow): string {
  const d = new Date(at)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  switch (window) {
    case '15m':
      return `${clock}:${pad(d.getSeconds())}`
    case '1h':
    case '6h':
      return clock
    case '24h':
    case '48h':
    case '7d':
      return `${WEEKDAYS[d.getDay()]} ${clock}`
    case '30d':
      return `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock}`
  }
}

/** One of a response's series, as points a chart can draw — each value at the start of its step. */
export function insightPoints(
  frame: InsightsFrame,
  series: InsightSeries | undefined
): { at: number; value: number | null }[] {
  if (!series) return []
  return series.values.map((value, i) => ({ at: frame.from + i * frame.stepMs, value }))
}

/** A series from a response, by the key the server named it with. */
export function insightSeries(list: InsightSeries[], key: string): InsightSeries | undefined {
  return list.find((s) => s.key === key)
}
