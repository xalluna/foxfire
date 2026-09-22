// Generates the Foxfire mark's geometry into packages/ui/src/assets/logoMark.json,
// where the Logo component both clients draw reads it.
//
// The mark is three wisps circling an empty centre. Each wisp is a ribbon whose
// spine *is* the orbit circle — so the tails do not merely suggest rotation,
// they trace the exact path the wisps travel. That is the whole reason this is
// generated rather than drawn by hand: offsetting a tapering width along an arc
// is not something you can eyeball with Bezier control points, and the earlier
// hand-fitted attempts all produced a pinch where the tail met the head.
//
// The output is a flat polyline. It is machine-written and not meant to be
// edited: change the constants below and re-run.
//
// Run with: node scripts/make-mark.mjs   (or `npm run make-mark`)
// Then re-run `npm run make-icon`, which redraws the .ico, the tray icon and
// the favicon from the same file.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, '..', '..', 'packages', 'ui', 'src', 'assets', 'logoMark.json')

/** The 24-unit grid every icon in the app is drawn on. */
const GRID = 24

/** Radius of the orbit the wisp heads sit on, and which their tails follow. */
const R = 6.0

/** Radius of the round head. Also the ribbon's half-width where it leaves. */
const RB = 1.8

/**
 * How far around the orbit each tail sweeps, in radians.
 *
 * Bounded by the next wisp: three heads 120 degrees apart, each occupying
 * asin(RB/R) either side, leaves about 25 degrees of clear space at this value.
 * Much more and the mark closes into a solid ring instead of reading as three
 * separate wisps.
 */
const SWEEP = 1.35

/**
 * Width profile, as (1 - u^K)^P against u = t/SWEEP.
 *
 * K > 1 makes the width leave the head at zero slope, so the ribbon flows out
 * of the circle instead of meeting it at a shoulder. P < 1 makes it reach zero
 * with infinite slope, so the tail ends in a real point rather than a stub.
 */
const K = 1.3
const P = 0.85

/** Samples per flank. 56 is past the point where more is visible at 512px. */
const STEPS = 56

const round = (n) => Math.round(n * 1000) / 1000

/** Spine: the orbit circle, in the wisp's own frame with its head at the origin. */
const spine = (t) => [R * Math.sin(t), R * (1 - Math.cos(t))]

/** Unit normal pointing away from the orbit's centre. */
const normal = (t) => [Math.sin(t), -Math.cos(t)]

const halfWidth = (t) => RB * Math.pow(1 - Math.pow(t / SWEEP, K), P)

function outline() {
  const outer = []
  const inner = []

  for (let i = 0; i <= STEPS; i += 1) {
    const t = (i / STEPS) * SWEEP
    const [sx, sy] = spine(t)
    const [nx, ny] = normal(t)
    const w = halfWidth(t)
    outer.push([sx + w * nx, sy + w * ny])
    inner.push([sx - w * nx, sy - w * ny])
  }

  inner.reverse()

  // Down the outer flank to the tip, back up the inner flank, then the head cap
  // closes the shape as a semicircle through the far side of the origin.
  const points = [...outer, ...inner.slice(1)]
  const path = points.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L ')
  return `M ${path} A ${RB} ${RB} 0 0 1 0 ${-RB} Z`
}

/** Heads at the top, lower right and lower left, each rotated to face along the orbit. */
function placements() {
  return [-90, 30, 150].map((degrees) => {
    const radians = (degrees * Math.PI) / 180
    const x = round(GRID / 2 + R * Math.cos(radians))
    const y = round(GRID / 2 + R * Math.sin(radians))
    const turn = degrees + 90
    return turn === 0 ? `translate(${x} ${y})` : `translate(${x} ${y}) rotate(${turn})`
  })
}

const mark = {
  _generated: 'scripts/make-mark.mjs — do not edit by hand; change the constants there and re-run',
  grid: GRID,
  // Furthest any point sits from the centre of the grid: the head's outer edge.
  extent: round(R + RB),
  wisp: outline(),
  placements: placements()
}

const previous = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    return null
  }
})()

writeFileSync(OUT, `${JSON.stringify(mark, null, 2)}\n`)

const clearance = 120 - (SWEEP * 180) / Math.PI - (Math.asin(RB / R) * 180) / Math.PI
console.log(`  ok  ${OUT.slice(ROOT.length + 1)}`)
console.log(
  `      sweep ${((SWEEP * 180) / Math.PI).toFixed(1)}deg, ${clearance.toFixed(1)}deg clear of the next head, extent ${mark.extent}`
)
if (previous && previous.wisp !== mark.wisp) console.log('      geometry changed — re-run `npm run make-icon`')
