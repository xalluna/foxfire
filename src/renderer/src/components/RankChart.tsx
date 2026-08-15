import { useState } from 'react'
import { format } from 'date-fns'
import type { RankSnapshot } from '@shared/types'
import { tierBandBoundaries } from '@shared/ladder'
import { tierColor, tierLabel } from '../lib/rank'

const WIDTH = 720
const HEIGHT = 260
const PAD = { top: 12, right: 12, bottom: 24, left: 52 }

const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

/**
 * The climb, drawn as plain SVG.
 *
 * Hand-rolled rather than pulled from a charting library: this needs tier bands
 * as a background, crest markers on individual points and colours driven by
 * League's own tier palette, all of which fight a general-purpose chart API —
 * and it keeps the dependency list as short as the rest of the app's.
 *
 * The Y axis is ladder position (see shared/ladder.ts), which folds tier,
 * division and LP into one continuous number so the line stays unbroken through
 * a promotion instead of snapping back to zero.
 */
export function RankChart({ snapshots }: { snapshots: RankSnapshot[] }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)

  const points = snapshots.filter((s) => s.ladderPosition !== null)
  if (points.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-text-mute">Nothing recorded yet.</p>
  }

  const positions = points.map((p) => p.ladderPosition as number)
  const times = points.map((p) => p.capturedAt)

  // A minimum span keeps a flat or single-point series from filling the plot
  // with one division blown up to full height.
  const rawMin = Math.min(...positions)
  const rawMax = Math.max(...positions)
  const pad = Math.max(40, (rawMax - rawMin) * 0.15)
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const tMin = Math.min(...times)
  const tMax = Math.max(...times)
  const tSpan = tMax - tMin || 1

  const x = (t: number): number => PAD.left + ((t - tMin) / tSpan) * PLOT_W
  const y = (p: number): number => PAD.top + (1 - (p - yMin) / (yMax - yMin || 1)) * PLOT_H

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.capturedAt)} ${y(p.ladderPosition as number)}`).join(' ')
  const area = `${line} L${x(tMax)} ${PAD.top + PLOT_H} L${x(tMin)} ${PAD.top + PLOT_H} Z`

  const latest = points[points.length - 1]
  const lineColor = tierColor(latest.tier)

  // Only the boundaries inside the visible range, so a short series is not
  // covered in labels for tiers it never touched.
  const bands = tierBandBoundaries().filter((b) => b.start >= yMin - 400 && b.start <= yMax + 400)

  // Division gridlines within the visible span, one per 100 LP.
  const divisionLines: number[] = []
  for (let p = Math.ceil(yMin / 100) * 100; p <= yMax; p += 100) divisionLines.push(p)

  const active = hover === null ? null : points[hover]

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Rank over time"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="rank-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {divisionLines.map((p) => (
          <line
            key={p}
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(p)}
            y2={y(p)}
            stroke="rgb(var(--hairline))"
            strokeWidth="1"
          />
        ))}

        {/* Tier boundaries get a tinted rule and a label, so vertical distance
            reads as rank rather than as an abstract number. */}
        {bands.map((band) => (
          <g key={band.tier}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(band.start)}
              y2={y(band.start)}
              stroke={tierColor(band.tier)}
              strokeOpacity="0.35"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 8}
              y={y(band.start) + 3}
              textAnchor="end"
              className="text-[9px]"
              fill={tierColor(band.tier)}
              fillOpacity="0.8"
            >
              {tierLabel(band.tier, null)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#rank-fill)" />
        <path d={line} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" />

        {points.map((p, i) => {
          const isEdge = i === 0 || i === points.length - 1
          return (
            <circle
              key={`${p.capturedAt}-${i}`}
              cx={x(p.capturedAt)}
              cy={y(p.ladderPosition as number)}
              r={hover === i ? 4.5 : isEdge ? 3 : 2}
              fill={hover === i ? lineColor : 'rgb(var(--canvas))'}
              stroke={lineColor}
              strokeWidth="1.5"
            />
          )
        })}

        {/* Full-height hit strips: the line itself is far too thin to hover
            reliably, and one strip per point keeps the tooltip predictable. */}
        {points.map((p, i) => {
          const half = PLOT_W / Math.max(points.length - 1, 1) / 2
          return (
            <rect
              key={`hit-${i}`}
              x={x(p.capturedAt) - half}
              y={PAD.top}
              width={half * 2}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          )
        })}

        <text x={PAD.left} y={HEIGHT - 6} className="text-[9px]" fill="rgb(var(--text-mute))">
          {format(tMin, 'MMM d')}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="text-[9px]"
          fill="rgb(var(--text-mute))"
        >
          {format(tMax, 'MMM d')}
        </text>
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-hairline bg-canvas px-2 py-1.5 text-2xs shadow-lg"
          style={{
            left: `${(x(active.capturedAt) / WIDTH) * 100}%`,
            top: `${(y(active.ladderPosition as number) / HEIGHT) * 100}%`
          }}
        >
          <p className="font-medium" style={{ color: tierColor(active.tier) }}>
            {tierLabel(active.tier, active.rank)}
          </p>
          <p className="tabular-nums text-text-dim">{active.leaguePoints ?? 0} LP</p>
          <p className="tabular-nums text-text-mute">{format(active.capturedAt, 'MMM d, HH:mm')}</p>
        </div>
      )}
    </div>
  )
}
