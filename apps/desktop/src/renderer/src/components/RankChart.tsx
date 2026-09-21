import { useId, useState } from 'react'
import { format } from 'date-fns'
import type { RankSnapshot } from '@shared/types'
import { tierBandBoundaries } from '@foxfire/core'
import { roundedPath } from '../lib/curve'
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
  // The gradient and mask are referenced by id, which is document-global — two
  // charts on one screen would otherwise silently share the first one's colours.
  // useId's colons are stripped: they are legal in an id but not in every
  // engine's parsing of a url(#…) reference.
  const uid = useId().replace(/:/g, '')

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

  // One path per season rather than one for the whole series. Drawn straight
  // through, an annual reset puts a two-thousand-point vertical drop across the
  // middle of the chart and reads as a collapse the player never suffered — the
  // ladder was emptied, not lost. Breaking the line says the true thing: these
  // are separate climbs that cannot be compared by eye.
  //
  // Split on the stamped seasonId, so the renderer needs no copy of the season
  // table and cannot draw before one has loaded. A boundary that carried rank
  // forward — a preseason — breaks the line too, but its two ends sit at nearly
  // the same height, so it reads as the hairline gap between two periods rather
  // than as a fall.
  const segments: RankSnapshot[][] = []
  for (const point of points) {
    const open = segments[segments.length - 1]
    if (open && open[open.length - 1].seasonId === point.seasonId) open.push(point)
    else segments.push([point])
  }

  const baseline = PAD.top + PLOT_H
  const paths = segments.map((segment) => {
    const line = roundedPath(segment.map((p) => [x(p.capturedAt), y(p.ladderPosition as number)]))
    const from = x(segment[0].capturedAt)
    const to = x(segment[segment.length - 1].capturedAt)
    return { line, area: `${line} L${to} ${baseline} L${from} ${baseline} Z` }
  })

  // Colour follows the tier the player was actually in at that moment, so a
  // segment that ends in a promotion is drawn in the tier it was climbing out
  // of. The stops are hard-edged pairs at the same offset: the new colour
  // begins exactly at the snapshot that first reported the new tier.
  const stops: Array<{ offset: number; color: string }> = [
    { offset: 0, color: tierColor(points[0].tier) }
  ]
  for (let i = 1; i < points.length; i++) {
    if (points[i].tier === points[i - 1].tier) continue
    const offset = (x(points[i].capturedAt) - PAD.left) / (PLOT_W || 1)
    stops.push({ offset, color: tierColor(points[i - 1].tier) })
    stops.push({ offset, color: tierColor(points[i].tier) })
  }

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
          {/* One gradient drives both the stroke and the fill, so the two can
              never disagree about which tier a moment belonged to. */}
          <linearGradient
            id={`${uid}-tiers`}
            gradientUnits="userSpaceOnUse"
            x1={PAD.left}
            y1="0"
            x2={WIDTH - PAD.right}
            y2="0"
          >
            {stops.map((s, i) => (
              <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} />
            ))}
          </linearGradient>

          {/* The fill needs to fade vertically as well as change colour
              horizontally, which one gradient cannot do. Masking the tinted
              area with a vertical ramp gets both. */}
          <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask
            id={`${uid}-fade-mask`}
            maskUnits="userSpaceOnUse"
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={PLOT_H}
          >
            <rect
              x={PAD.left}
              y={PAD.top}
              width={PLOT_W}
              height={PLOT_H}
              fill={`url(#${uid}-fade)`}
            />
          </mask>
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

        {paths.map((p, i) => (
          <path
            key={`area-${i}`}
            d={p.area}
            fill={`url(#${uid}-tiers)`}
            mask={`url(#${uid}-fade-mask)`}
          />
        ))}
        {paths.map((p, i) => (
          <path
            key={`line-${i}`}
            d={p.line}
            fill="none"
            stroke={`url(#${uid}-tiers)`}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        ))}

        {/* Only the endpoints are marked. A dot per point would visibly detach
            from the line wherever a corner was rounded away, and the series is
            dense enough that the dots read as noise rather than as data. Every
            segment gets its own pair, so where a ranked year starts and ends is
            marked rather than merely implied by the gap. */}
        {segments.flatMap((segment, s) =>
          [segment[0], segment[segment.length - 1]].map((p, i) => (
            <circle
              key={`edge-${s}-${i}`}
              cx={x(p.capturedAt)}
              cy={y(p.ladderPosition as number)}
              r={3}
              fill="rgb(var(--canvas))"
              stroke={tierColor(p.tier)}
              strokeWidth="1.5"
            />
          ))
        )}

        {/* The hovered point sits at its true position, not on the curve, so a
            rounded corner never moves the reading away from the tooltip. */}
        {active && (
          <circle
            cx={x(active.capturedAt)}
            cy={y(active.ladderPosition as number)}
            r={4.5}
            fill={tierColor(active.tier)}
            stroke={tierColor(active.tier)}
            strokeWidth="1.5"
          />
        )}

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
