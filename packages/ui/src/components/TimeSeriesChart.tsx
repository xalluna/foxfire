import { useId, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { roundedPath, type Point } from '../lib/curve'

const WIDTH = 720
const HEIGHT = 200
const PAD = { top: 10, right: 12, bottom: 22, left: 52 }

const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

export interface Series {
  label: string
  /** A CSS colour, usually `rgb(var(--teal))`. */
  colour: string
  points: { at: number; value: number | null }[]
  /** Draws a gradient under the line. Only sensible for a single-series chart. */
  fill?: boolean
  /** Renders as a step function — right for counters that hold a value. */
  step?: boolean
}

/**
 * A multi-series time chart in plain SVG.
 *
 * Hand-rolled for the same reason RankChart.tsx is: adding a charting library
 * for a developer panel would be the first such dependency in an app that has
 * nine, and the shapes needed here — a ceiling line, threshold shading, event
 * markers — are the ones general-purpose chart APIs make awkward anyway.
 *
 * Shared by the desktop's own telemetry panel and a server's insights page,
 * which is what makes hand-rolling cheap: the scale, hover and axis code is
 * written once. The time span is every point handed in, measured or not, so a
 * window the server was down for part of still reads as the whole window.
 */
export function TimeSeriesChart({
  series,
  yMax: yMaxOverride,
  threshold,
  markers,
  formatValue,
  formatAt = formatClockMs,
  timeAxis = false,
  emptyText = 'Nothing recorded yet.',
  ariaLabel
}: {
  series: Series[]
  /** Pins the top of the axis, so a chart with a known ceiling keeps its scale. */
  yMax?: number
  /** A horizontal reference line — the rate-limit ceiling. */
  threshold?: { value: number; label: string }
  /** Vertical event markers, e.g. every 429. */
  markers?: number[]
  formatValue: (value: number) => string
  /** How a moment is written under the hover and on the time axis. Milliseconds by default. */
  formatAt?: (at: number) => string
  /** Labels the start and end of the span under the plot. */
  timeAxis?: boolean
  emptyText?: string
  ariaLabel: string
}): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)

  // Per chart, so two filled charts on one page each find their own gradient
  // rather than both drawing the first one's.
  const gradientId = `ts${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const all = series.flatMap((s) => s.points)
  const values = all.map((p) => p.value).filter((v): v is number => v !== null)

  if (values.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-text-mute">{emptyText}</p>
  }

  const tMin = Math.min(...all.map((p) => p.at))
  const tMax = Math.max(...all.map((p) => p.at))
  const tSpan = tMax - tMin || 1

  // A floor of 1 keeps an all-zero series from collapsing to a divide-by-zero,
  // and including the threshold keeps the ceiling on screen even when usage
  // never approaches it.
  const yMax = Math.max(1, yMaxOverride ?? Math.max(...values, threshold?.value ?? 0) * 1.1)

  const x = (t: number): number => PAD.left + ((t - tMin) / tSpan) * PLOT_W
  const y = (v: number): number => PAD.top + (1 - Math.min(v, yMax) / yMax) * PLOT_H

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax)

  // Hover resolves against a shared time grid rather than one series' points,
  // so a multi-series chart reads every line at the same instant.
  const times = [...new Set(all.map((p) => p.at))].sort((a, b) => a - b)
  const hoverAt = hover === null ? null : times[hover]

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.label} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.colour} stopOpacity="0.25" />
              <stop offset="100%" stopColor={s.colour} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke="rgb(var(--hairline))"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 8}
              y={y(v) + 3}
              textAnchor="end"
              className="fill-[rgb(var(--text-mute))] text-[9px]"
            >
              {formatValue(v)}
            </text>
          </g>
        ))}

        {markers?.map((at, i) => (
          <line
            key={`${at}-${i}`}
            x1={x(at)}
            x2={x(at)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="rgb(var(--red))"
            strokeWidth="1"
            strokeOpacity="0.5"
            strokeDasharray="2 2"
          />
        ))}

        {threshold && (
          <>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(threshold.value)}
              y2={y(threshold.value)}
              stroke="rgb(var(--red))"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <text
              x={WIDTH - PAD.right}
              y={y(threshold.value) - 4}
              textAnchor="end"
              className="fill-[rgb(var(--red))] text-[9px]"
            >
              {threshold.label}
            </text>
          </>
        )}

        {series.map((s, i) => {
          const runs = buildRuns(s, x, y)
          if (runs.length === 0) return null
          const floor = PAD.top + PLOT_H
          return (
            <g key={s.label}>
              {s.fill && (
                // Each run closed down to the floor on its own, so a gap stays
                // a gap rather than being bridged by one fill across it.
                <path
                  d={runs.map((run) => `${run.path} L${run.lastX} ${floor} L${run.firstX} ${floor} Z`).join(' ')}
                  fill={`url(#${gradientId}-${i})`}
                />
              )}
              <path d={runs.map((run) => run.path).join(' ')} fill="none" stroke={s.colour} strokeWidth="1.5" />
            </g>
          )
        })}

        {/* Full-height invisible strips give the whole column a hover target, the
            same approach RankChart uses. */}
        {times.map((at, i) => (
          <rect
            key={at}
            x={x(at) - PLOT_W / Math.max(times.length, 1) / 2}
            y={PAD.top}
            width={PLOT_W / Math.max(times.length, 1)}
            height={PLOT_H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {timeAxis && (
          <>
            <text x={PAD.left} y={HEIGHT - 6} className="fill-[rgb(var(--text-mute))] text-[9px]">
              {formatAt(tMin)}
            </text>
            <text
              x={WIDTH - PAD.right}
              y={HEIGHT - 6}
              textAnchor="end"
              className="fill-[rgb(var(--text-mute))] text-[9px]"
            >
              {formatAt(tMax)}
            </text>
          </>
        )}

        {hoverAt !== null && (
          <line
            x1={x(hoverAt)}
            x2={x(hoverAt)}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke="rgb(var(--accent))"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        )}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-3 px-1">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-2xs text-text-mute">
            <span className="h-0.5 w-3 rounded" style={{ backgroundColor: s.colour }} />
            {s.label}
            {hoverAt !== null && (
              <span className="font-mono text-text-dim">{readAt(s, hoverAt, formatValue)}</span>
            )}
          </span>
        ))}
        {hoverAt !== null && (
          <span className="ml-auto font-mono text-2xs text-text-mute">{formatAt(hoverAt)}</span>
        )}
      </div>
    </div>
  )
}

/** Each stretch of measured points as its own subpath, with where it starts and ends across. */
function buildRuns(
  series: Series,
  x: (t: number) => number,
  y: (v: number) => number
): Array<{ path: string; firstX: number; lastX: number }> {
  return measuredRuns(series).map((run) => {
    const scaled: Point[] = run.map((p) => [x(p.at), y(p.value)])
    return { path: runPath(scaled, series.step), firstX: scaled[0][0], lastX: scaled[scaled.length - 1][0] }
  })
}

function runPath(scaled: Point[], step: boolean | undefined): string {
  // A counter holds its value between samples, so the staircase *is* the
  // reading — rounding those corners would draw a ramp that never happened.
  // Gauges are sampled from something continuous, so they get the curve.
  if (!step) return roundedPath(scaled)

  return scaled
    .map(([px, py], i) => (i === 0 ? `M${px} ${py}` : ` L${px} ${scaled[i - 1][1]} L${px} ${py}`))
    .join('')
}

/**
 * The series split into contiguous stretches of measured points.
 *
 * A null ends the run rather than being drawn across — idle periods should read
 * as absent data, not as a value of zero — and each run becomes its own subpath.
 */
function measuredRuns(series: Series): Array<Array<{ at: number; value: number }>> {
  const runs: Array<Array<{ at: number; value: number }>> = []
  let current: Array<{ at: number; value: number }> = []

  for (const point of series.points) {
    if (point.value === null) {
      if (current.length > 0) runs.push(current)
      current = []
      continue
    }
    current.push({ at: point.at, value: point.value })
  }
  if (current.length > 0) runs.push(current)

  return runs
}

function readAt(series: Series, at: number, formatValue: (value: number) => string): string {
  const point = series.points.find((p) => p.at === at)
  return point?.value === null || point === undefined ? '—' : formatValue(point.value)
}

/** A moment to the millisecond, for a panel whose points are that close together. */
function formatClockMs(at: number): string {
  const d = new Date(at)
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** A chart with a title, and a hint beside it saying how to read it. */
export function ChartCard({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className={clsx('rounded-lg border border-hairline bg-surface p-4')}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-display text-sm text-text">{title}</h2>
        {hint && <p className="text-2xs text-text-mute">{hint}</p>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}
