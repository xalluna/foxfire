import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { RankTrend, RankTrendPoint } from '@foxfire/core'
import { RANK_TREND_DAYS, rankAtPosition } from '@foxfire/core'
import { roundedPath } from '../lib/curve'
import { formatTierShort, tierColor, tierLabel } from '../lib/rank'

const DAY_MS = 86_400_000

// Drawn at the width it is shown at, measured, so its 9px labels stay 9px
// whether it sits in the 320px rail or across half the main column below
// 1280px — a fixed viewBox would scale them to nothing in one and to headings
// in the other. The height is fixed. 296 is the rail's, and what it draws at
// before the first measurement.
const RAIL_WIDTH = 296
const HEIGHT = 112
const PAD = { top: 8, right: 8, bottom: 18, left: 26 }

const PLOT_H = HEIGHT - PAD.top - PAD.bottom

/** Where the day marks go, in days back from today. */
const TICKS = [30, 20, 10, 0]

type Plotted = RankTrendPoint & { ladderPosition: number }

function daysAgo(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days} days ago`
}

/**
 * The profile's rank graph: thirty days, a close a day.
 *
 * The small sibling of RankChart, and drawn by the same rule — closes, see
 * rules/rankTrend.ts — though from the thirty days the server thins for
 * exactly this rather than from the Rank page's whole range, so its thirty
 * days and the Rank page's are the same line. The x axis is the whole month
 * whatever was played in it, so a
 * quiet fortnight is a flat stretch rather than a line that starts late — and
 * where it does start late, that is where tracking began.
 *
 * Same conventions as the big chart, so the two read as one thing at two
 * sizes: ladder position up the side, the line coloured by the tier it was in,
 * and broken at a season boundary rather than drawn through a reset.
 */
export function RankTrendChart({ trend }: { trend: RankTrend }): JSX.Element | null {
  const [hover, setHover] = useState<number | null>(null)
  const [width, setWidth] = useState(RAIL_WIDTH)
  const frame = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    // A copy in a hidden column measures 0; it keeps drawing at the rail's width.
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry.contentRect.width)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotW = width - PAD.left - PAD.right
  // Document-global ids, and this card renders twice below 1280px — once in
  // the hidden rail — so each copy needs its own or the visible one would
  // point at defs inside an SVG that is not painted.
  const uid = useId().replace(/:/g, '')

  const points = trend.points.filter((p): p is Plotted => p.ladderPosition !== null)
  if (points.length === 0) return <div ref={frame} />

  const positions = points.map((p) => p.ladderPosition)
  const rawMin = Math.min(...positions)
  const rawMax = Math.max(...positions)
  // A quarter of a division either side at least, so a flat month is a line
  // across the middle rather than one pressed against the top.
  const pad = Math.max(25, (rawMax - rawMin) * 0.15)
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const span = trend.to - trend.from || 1
  const x = (at: number): number => PAD.left + ((at - trend.from) / span) * plotW
  const y = (p: number): number => PAD.top + (1 - (p - yMin) / (yMax - yMin || 1)) * PLOT_H

  // Broken wherever the days stop being consecutive — a reset with nothing
  // since, which the server leaves out — and wherever the season changes, the
  // same break the big chart makes.
  const segments: Plotted[][] = []
  for (const point of points) {
    const open = segments[segments.length - 1]
    const last = open?.[open.length - 1]
    if (last && last.seasonId === point.seasonId && point.at - last.at === DAY_MS) open.push(point)
    else segments.push([point])
  }

  const baseline = PAD.top + PLOT_H
  const paths = segments.map((segment) => {
    const line = roundedPath(
      segment.map((p) => [x(p.at), y(p.ladderPosition)]),
      4
    )
    const from = x(segment[0].at)
    const to = x(segment[segment.length - 1].at)
    return { line, area: `${line} L${to} ${baseline} L${from} ${baseline} Z` }
  })

  // Hard-edged tier stops, as on the big chart: the colour changes at the day
  // that first closed in the new tier.
  const stops: Array<{ offset: number; color: string }> = [
    { offset: 0, color: tierColor(points[0].tier) }
  ]
  for (let i = 1; i < points.length; i++) {
    if (points[i].tier === points[i - 1].tier) continue
    const offset = (x(points[i].at) - PAD.left) / plotW
    stops.push({ offset, color: tierColor(points[i - 1].tier) })
    stops.push({ offset, color: tierColor(points[i].tier) })
  }

  // Division lines, or tier lines once a month spans too many divisions for a
  // line each to mean anything at this height.
  const step = rawMax - rawMin > 600 ? 400 : 100
  const gridlines: number[] = []
  for (let p = Math.ceil(yMin / step) * step; p <= yMax; p += step) gridlines.push(p)

  // The two ends of the range, named the way the match rows name a rank.
  const top = rankAtPosition(rawMax)
  const bottom = rankAtPosition(rawMin)
  const topLabel = formatTierShort(top.tier, top.rank)
  const bottomLabel = formatTierShort(bottom.tier, bottom.rank)

  const active = hover === null ? null : points[hover]
  const latest = points[points.length - 1]

  return (
    <div ref={frame} className="relative">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        className="block"
        role="img"
        aria-label="Rank over the last 30 days"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient
            id={`${uid}-tiers`}
            gradientUnits="userSpaceOnUse"
            x1={PAD.left}
            y1="0"
            x2={width - PAD.right}
            y2="0"
          >
            {stops.map((s, i) => (
              <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} />
            ))}
          </linearGradient>
          <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask
            id={`${uid}-fade-mask`}
            maskUnits="userSpaceOnUse"
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={PLOT_H}
          >
            <rect x={PAD.left} y={PAD.top} width={plotW} height={PLOT_H} fill={`url(#${uid}-fade)`} />
          </mask>
        </defs>

        {gridlines.map((p) => (
          <line
            key={`h-${p}`}
            x1={PAD.left}
            x2={width - PAD.right}
            y1={y(p)}
            y2={y(p)}
            stroke="rgb(var(--hairline))"
            strokeWidth="1"
          />
        ))}

        {TICKS.map((days) => {
          const at = x(trend.to - days * DAY_MS)
          return (
            <g key={`t-${days}`}>
              <line
                x1={at}
                x2={at}
                y1={PAD.top}
                y2={baseline}
                stroke="rgb(var(--hairline))"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <text
                x={at}
                y={HEIGHT - 5}
                textAnchor={days === RANK_TREND_DAYS ? 'start' : days === 0 ? 'end' : 'middle'}
                className="text-[9px]"
                fill="rgb(var(--text-mute))"
              >
                {days === 0 ? 'today' : `${days}d`}
              </text>
            </g>
          )
        })}

        {topLabel && (
          <text
            x={PAD.left - 5}
            y={y(rawMax) + 3}
            textAnchor="end"
            className="text-[9px]"
            fill={tierColor(top.tier)}
          >
            {topLabel}
          </text>
        )}
        {/* Only where there is room for two: a month inside one division, or
            one that barely crossed a boundary, gets the top label alone. */}
        {bottomLabel && bottomLabel !== topLabel && y(rawMin) - y(rawMax) >= 11 && (
          <text
            x={PAD.left - 5}
            y={y(rawMin) + 3}
            textAnchor="end"
            className="text-[9px]"
            fill={tierColor(bottom.tier)}
          >
            {bottomLabel}
          </text>
        )}

        {paths.map((p, i) => (
          <path key={`area-${i}`} d={p.area} fill={`url(#${uid}-tiers)`} mask={`url(#${uid}-fade-mask)`} />
        ))}
        {paths.map((p, i) => (
          <path
            key={`line-${i}`}
            d={p.line}
            fill="none"
            stroke={`url(#${uid}-tiers)`}
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        ))}

        {/* Where it stands now, which is the reading the card above it names. */}
        <circle
          cx={x(latest.at)}
          cy={y(latest.ladderPosition)}
          r={2.75}
          fill="rgb(var(--canvas))"
          stroke={tierColor(latest.tier)}
          strokeWidth="1.5"
        />

        {active && (
          <circle
            cx={x(active.at)}
            cy={y(active.ladderPosition)}
            r={3.75}
            fill={tierColor(active.tier)}
            stroke={tierColor(active.tier)}
            strokeWidth="1.5"
          />
        )}

        {/* A strip a day wide under each point. The days are evenly spaced by
            construction, so every strip is the same width. */}
        {points.map((p, i) => {
          const half = plotW / RANK_TREND_DAYS / 2
          return (
            <rect
              key={`hit-${p.at}`}
              x={x(p.at) - half}
              y={PAD.top}
              width={half * 2}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          )
        })}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+8px)] whitespace-nowrap rounded-md border border-hairline bg-canvas px-2 py-1.5 text-2xs shadow-lg"
          style={{
            // Held inside the card: at either end a centred tooltip would hang
            // off the rail's edge. Pixels, because the drawing is at 1:1.
            left: Math.min(Math.max(x(active.at), 48), width - 48),
            top: y(active.ladderPosition)
          }}
        >
          <p className="font-medium" style={{ color: tierColor(active.tier) }}>
            {tierLabel(active.tier, active.rank)}
          </p>
          <p className="tabular-nums text-text-dim">{active.leaguePoints ?? 0} LP</p>
          <p className="tabular-nums text-text-mute">
            {daysAgo(Math.round((trend.to - active.at) / DAY_MS))}
          </p>
        </div>
      )}
    </div>
  )
}
