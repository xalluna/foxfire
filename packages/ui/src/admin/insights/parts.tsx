import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  formatInsightTime,
  insightPoints,
  insightSeries,
  type InsightSeries,
  type InsightsFrame
} from '@foxfire/core'
import { ChartCard, TimeSeriesChart, type Series } from '../../components/TimeSeriesChart'

/** The chart colours, as the rest of the app uses them. */
export const COLOUR = {
  teal: 'rgb(var(--teal))',
  accent: 'rgb(var(--accent))',
  accentDim: 'rgb(var(--accent-dim))',
  amber: 'rgb(var(--amber))',
  red: 'rgb(var(--red))',
  gold: 'rgb(var(--gold))',
  dim: 'rgb(var(--text-dim))'
} as const

export type Tone = 'normal' | 'good' | 'warn' | 'bad'

const TONE_TEXT: Record<Tone, string> = {
  normal: 'text-text',
  good: 'text-teal',
  warn: 'text-amber',
  bad: 'text-red'
}

const TONE_CHIP: Record<Tone, string> = {
  normal: 'border-hairline bg-canvas text-text-dim',
  good: 'border-teal/30 bg-teal/10 text-teal',
  warn: 'border-amber/40 bg-amber/10 text-amber',
  bad: 'border-red/40 bg-red/10 text-red'
}

/** A headline figure: what it is, the number, and a line under it. */
export function Tile({
  label,
  value,
  detail,
  tone = 'normal'
}: {
  label: string
  value: string
  detail?: ReactNode
  tone?: Tone
}): JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-hairline bg-surface px-4 py-3">
      <p className="truncate text-2xs font-medium uppercase tracking-widest text-text-mute">{label}</p>
      <p className={clsx('mt-1 truncate font-mono text-lg tabular-nums', TONE_TEXT[tone])}>{value}</p>
      {detail !== undefined && <p className="mt-0.5 truncate text-2xs text-text-dim">{detail}</p>}
    </div>
  )
}

/** Tiles in a grid: two across on a phone, four on anything wider. */
export function Tiles({ children }: { children: ReactNode }): JSX.Element {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
}

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }): JSX.Element {
  return (
    <span className={clsx('inline-block whitespace-nowrap rounded border px-1.5 py-px text-2xs', TONE_CHIP[tone])}>
      {children}
    </span>
  )
}

/** One line of a chart: which of the response's series, and how to draw it. */
export interface Line {
  key: string
  label: string
  colour: string
  /** A count per point is a staircase; a level is a curve. */
  step?: boolean
  fill?: boolean
}

/**
 * A chart of some of a response's series, over its frame.
 *
 * Labelled in the window's own time — seconds for fifteen minutes, days for a
 * month — and spanning the whole window whatever was measured, so a server
 * that was down for part of it shows a gap rather than a shorter chart.
 */
export function InsightChart({
  title,
  hint,
  frame,
  source,
  lines,
  format,
  threshold,
  markers,
  yMax
}: {
  title: string
  hint?: string
  frame: InsightsFrame
  source: InsightSeries[]
  lines: Line[]
  format: (value: number) => string
  threshold?: { value: number; label: string }
  markers?: number[]
  yMax?: number
}): JSX.Element {
  const series: Series[] = lines.map((line) => ({
    label: line.label,
    colour: line.colour,
    step: line.step,
    fill: line.fill,
    points: insightPoints(frame, insightSeries(source, line.key))
  }))

  return (
    <ChartCard title={title} hint={hint}>
      <TimeSeriesChart
        series={series}
        formatValue={format}
        formatAt={(at) => formatInsightTime(at, frame.window)}
        timeAxis
        threshold={threshold}
        markers={markers}
        yMax={yMax}
        emptyText="Nothing measured in this window."
        ariaLabel={title}
      />
    </ChartCard>
  )
}

/** The moments a series was above zero — every 429, say — for a chart's markers. */
export function markersWhere(frame: InsightsFrame, series: InsightSeries | undefined): number[] {
  if (!series) return []
  return series.values.flatMap((value, i) => (value !== null && value > 0 ? [frame.from + i * frame.stepMs] : []))
}

export interface Column<T> {
  header: string
  /** Right-aligned and in tabular figures: a number. */
  numeric?: boolean
  cell: (row: T) => ReactNode
}

/**
 * A table of figures. Scrolls sideways rather than squeezing on a phone, where
 * a route template and six numbers do not fit any other way.
 */
export function Table<T>({
  title,
  description,
  rows,
  columns,
  rowKey,
  empty
}: {
  title: string
  description?: string
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  empty: string
}): JSX.Element {
  return (
    <section>
      <div className="mb-2">
        <h2 className="font-display text-base text-text-dim">{title}</h2>
        {description && <p className="mt-1 text-2xs leading-relaxed text-text-mute">{description}</p>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-mute">{empty}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-hairline text-2xs uppercase tracking-widest text-text-mute">
                {columns.map((column) => (
                  <th
                    key={column.header}
                    scope="col"
                    className={clsx(
                      'whitespace-nowrap px-3 py-2 font-medium',
                      column.numeric ? 'text-right' : 'text-left'
                    )}
                  >
                    {column.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td
                      key={column.header}
                      className={clsx(
                        'px-3 py-2',
                        column.numeric ? 'whitespace-nowrap text-right font-mono tabular-nums text-text' : 'text-text-dim'
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

/** A count, with thousands separated. */
export function count(value: number): string {
  return Math.round(value).toLocaleString()
}

/** A count and what it counts: 1 warning, 2 warnings. */
export function counted(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${Math.round(value) === 1 ? one : many}`
}

/** A share of a whole, as a percentage worth reading: one place under ten, none above. */
export function percent(part: number, whole: number): string {
  if (whole === 0) return '—'
  const pct = (part / whole) * 100
  if (pct === 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`
}

/** A figure already in percent. */
export function percentValue(value: number | null): string {
  return value === null ? '—' : `${value < 10 ? value.toFixed(1) : Math.round(value)}%`
}
