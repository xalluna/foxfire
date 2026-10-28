import { useId, useState } from 'react'
import { format } from 'date-fns'
import type { RankCloses, RankTrendPoint } from '@foxfire/core'
import { ratedBandBoundaries, ratedTierAt, tierBandBoundaries } from '@foxfire/core'
import { roundedPath } from '../lib/curve'
import { useMeasuredWidth } from '../hooks/useMeasuredWidth'
import { ratedTierColor, ratedTierLabel, tierColor, tierLabel } from '../lib/rank'

const DAY_MS = 86_400_000

// Drawn at the width it is shown at, measured, so its labels are the 11px
// they say rather than whatever a stretched viewBox makes of them. The height
// keeps the old 720 × 260 proportion, held between a height the bands still
// read at and one that does not take over a wide window. The left pad fits
// "Grandmaster" at that size.
const FALLBACK_WIDTH = 720
const ASPECT = 720 / 260
const MIN_HEIGHT = 200
const MAX_HEIGHT = 360
const PAD = { top: 12, right: 12, bottom: 26, left: 80 }

type Plotted = RankTrendPoint & { ladderPosition: number }

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
 *
 * Drawn from closes rather than from every reading — the profile's rule, see
 * rules/rankTrend.ts — so a busy evening is where it ended rather than a
 * sawtooth of every win and loss, and the big chart and the profile's small one
 * read as one thing at two sizes. The x axis is the whole range whatever was
 * played in it: a quiet fortnight is a flat stretch, and a line that starts
 * late starts where tracking began.
 *
 * A rated ladder — Hyper Roll — is the same graph of a different number: its
 * position is the rating, and the bands and colours are its own tiers, read
 * off the rating rather than off a tier the close carries.
 */
export function RankChart({ closes, rated = false }: { closes: RankCloses; rated?: boolean }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  // The gradient and mask are referenced by id, which is document-global — two
  // charts on one screen would otherwise silently share the first one's colours.
  // useId's colons are stripped: they are legal in an id but not in every
  // engine's parsing of a url(#…) reference.
  const uid = useId().replace(/:/g, '')
  const [frame, width] = useMeasuredWidth(FALLBACK_WIDTH)
  const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, width / ASPECT)))
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom

  const points = closes.points.filter((p): p is Plotted => p.ladderPosition !== null)
  if (points.length === 0) {
    return (
      <p ref={frame} className="px-4 py-10 text-center text-sm text-text-mute">
        Nothing recorded yet.
      </p>
    )
  }

  const positions = points.map((p) => p.ladderPosition)

  // Which band a close stands in, and its colour, on either kind of ladder.
  const bandOf = (p: Plotted): string | null => (rated ? ratedTierAt(p.ladderPosition) : p.tier)
  const colorOf = (band: string | null): string => (rated ? ratedTierColor(band) : tierColor(band))

  // A minimum span keeps a flat or single-point series from filling the plot
  // with one division blown up to full height.
  const rawMin = Math.min(...positions)
  const rawMax = Math.max(...positions)
  const pad = Math.max(40, (rawMax - rawMin) * 0.15)
  const yMin = Math.max(0, rawMin - pad)
  const yMax = rawMax + pad

  const tSpan = closes.to - closes.from || 1

  const x = (t: number): number => PAD.left + ((t - closes.from) / tSpan) * plotW
  const y = (p: number): number => PAD.top + (1 - (p - yMin) / (yMax - yMin || 1)) * plotH

  // One path per season rather than one for the whole series. Drawn straight
  // through, an annual reset puts a two-thousand-point vertical drop across the
  // middle of the chart and reads as a collapse the player never suffered — the
  // ladder was emptied, not lost. Breaking the line says the true thing: these
  // are separate climbs that cannot be compared by eye.
  //
  // Split on the season stamped on each close, and wherever the closes stop
  // being one step apart — a reset with nothing played since, which the rule
  // leaves out. A boundary that carried rank forward — a preseason — breaks the
  // line too, but its two ends sit at nearly the same height, so it reads as
  // the hairline gap between two periods rather than as a fall.
  const segments: Plotted[][] = []
  for (const point of points) {
    const open = segments[segments.length - 1]
    const last = open?.[open.length - 1]
    if (last && last.seasonId === point.seasonId && point.at - last.at === closes.step) {
      open.push(point)
    } else segments.push([point])
  }

  const baseline = PAD.top + plotH
  const paths = segments.map((segment) => {
    const line = roundedPath(segment.map((p) => [x(p.at), y(p.ladderPosition)]))
    const from = x(segment[0].at)
    const to = x(segment[segment.length - 1].at)
    return { line, area: `${line} L${to} ${baseline} L${from} ${baseline} Z` }
  })

  // Colour follows the tier the player was actually in at that moment, so a
  // segment that ends in a promotion is drawn in the tier it was climbing out
  // of. The stops are hard-edged pairs at the same offset: the new colour
  // begins exactly at the close that first stood in the new tier.
  const stops: Array<{ offset: number; color: string }> = [
    { offset: 0, color: colorOf(bandOf(points[0])) }
  ]
  for (let i = 1; i < points.length; i++) {
    if (bandOf(points[i]) === bandOf(points[i - 1])) continue
    const offset = (x(points[i].at) - PAD.left) / (plotW || 1)
    stops.push({ offset, color: colorOf(bandOf(points[i - 1])) })
    stops.push({ offset, color: colorOf(bandOf(points[i])) })
  }

  // Only the boundaries inside the visible range, so a short series is not
  // covered in labels for tiers it never touched.
  const bands = (rated ? ratedBandBoundaries() : tierBandBoundaries()).filter(
    (b) => b.start >= yMin - 400 && b.start <= yMax + 400
  )
  const bandLabel = (tier: string): string => (rated ? ratedTierLabel(tier) : tierLabel(tier, null))

  // Gridlines within the visible span: one per division's 100 LP, and every
  // 200 of a rating, which moves several times as far a game.
  const gridStep = rated ? 200 : 100
  const divisionLines: number[] = []
  for (let p = Math.ceil(yMin / gridStep) * gridStep; p <= yMax; p += gridStep) divisionLines.push(p)

  const active = hover === null ? null : points[hover]

  return (
    <div ref={frame} className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        className="block"
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
            x2={width - PAD.right}
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
            width={plotW}
            height={plotH}
          >
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill={`url(#${uid}-fade)`}
            />
          </mask>
        </defs>

        {divisionLines.map((p) => (
          <line
            key={p}
            x1={PAD.left}
            x2={width - PAD.right}
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
              x2={width - PAD.right}
              y1={y(band.start)}
              y2={y(band.start)}
              stroke={colorOf(band.tier)}
              strokeOpacity="0.35"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 8}
              y={y(band.start) + 4}
              textAnchor="end"
              className="text-2xs"
              fill={colorOf(band.tier)}
            >
              {bandLabel(band.tier)}
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
              cx={x(p.at)}
              cy={y(p.ladderPosition)}
              r={3}
              fill="rgb(var(--canvas))"
              stroke={colorOf(bandOf(p))}
              strokeWidth="1.5"
            />
          ))
        )}

        {/* The hovered point sits at its true position, not on the curve, so a
            rounded corner never moves the reading away from the tooltip. */}
        {active && (
          <circle
            cx={x(active.at)}
            cy={y(active.ladderPosition)}
            r={4.5}
            fill={colorOf(bandOf(active))}
            stroke={colorOf(bandOf(active))}
            strokeWidth="1.5"
          />
        )}

        {/* Full-height hit strips: the line itself is far too thin to hover
            reliably, and one strip per point keeps the tooltip predictable.
            The closes are evenly spaced, so every strip is a step wide. */}
        {points.map((p, i) => {
          const half = ((closes.step / tSpan) * plotW) / 2
          return (
            <rect
              key={`hit-${p.at}`}
              x={x(p.at) - half}
              y={PAD.top}
              width={half * 2}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          )
        })}

        <text x={PAD.left} y={height - 7} className="text-2xs" fill="rgb(var(--text-mute))">
          {format(closes.from, 'MMM d')}
        </text>
        <text
          x={width - PAD.right}
          y={height - 7}
          textAnchor="end"
          className="text-2xs"
          fill="rgb(var(--text-mute))"
        >
          {format(closes.to, 'MMM d')}
        </text>
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-hairline bg-canvas px-2 py-1.5 text-2xs shadow-lg"
          style={{
            // Held inside the chart, so a reading at either end does not hang
            // off it. Pixels, because the drawing is at 1:1.
            left: Math.min(Math.max(x(active.at), 56), width - 56),
            top: y(active.ladderPosition)
          }}
        >
          <p className="font-medium" style={{ color: colorOf(bandOf(active)) }}>
            {rated ? ratedTierLabel(bandOf(active)) : tierLabel(active.tier, active.rank)}
          </p>
          <p className="tabular-nums text-text-dim">
            {rated ? `${active.ladderPosition.toLocaleString()} rating` : `${active.leaguePoints ?? 0} LP`}
          </p>
          {/* When the close was drawn, not when its game was played: a day's
              close names the day, and six hours' the moment they ended. */}
          <p className="tabular-nums text-text-mute">
            {format(active.at, closes.step < DAY_MS ? 'MMM d, HH:mm' : 'MMM d')}
          </p>
        </div>
      )}
    </div>
  )
}
