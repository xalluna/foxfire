/** A point in SVG user space, already scaled. */
export type Point = [x: number, y: number]

/**
 * How far from a corner the rounding may start, in SVG user units.
 *
 * Only ever reached on long segments — see the clamp in `roundedPath` — so this
 * governs the gentle day-to-day stretches of a chart rather than its busy ones.
 */
const MAX_CORNER_RADIUS = 10

/** Below this a fillet is submerged by the stroke width, so skip the maths. */
const EPSILON = 0.01

/**
 * An SVG path through every point, with the corners rounded off.
 *
 * Deliberately not a smoothing spline. A Catmull-Rom or cardinal curve
 * overshoots between points, which on the rank chart would bulge the line
 * across a tier boundary the player never crossed — contradicting the milestone
 * list drawn right beneath it. A corner fillet cannot invent a value: it only
 * ever cuts a corner, and never by more than half its radius.
 *
 * Each corner becomes a quadratic Bézier whose control point is the vertex
 * itself, entered and left at distance `r` along the adjoining segments. `r` is
 * clamped to half of the shorter neighbour, which is what keeps two adjacent
 * fillets from overlapping — and when both hit that clamp they meet exactly,
 * so a dense run of points reads as one continuous curve instead of teeth.
 *
 * Collinear points need no special case: the control point lands on the line
 * and the Bézier degenerates into the straight segment it replaces.
 */
export function roundedPath(points: Point[], rMax: number = MAX_CORNER_RADIUS): string {
  if (points.length === 0) return ''

  const [x0, y0] = points[0]
  let path = `M${x0} ${y0}`

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]
    const [cx, cy] = points[i]
    const [nx, ny] = points[i + 1]

    const inLen = Math.hypot(cx - px, cy - py)
    const outLen = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(rMax, inLen / 2, outLen / 2)

    // A duplicated point leaves a zero-length segment with no direction to back
    // off along, so corner it squarely rather than dividing by zero.
    if (r < EPSILON) {
      path += ` L${cx} ${cy}`
      continue
    }

    const entryX = cx - ((cx - px) / inLen) * r
    const entryY = cy - ((cy - py) / inLen) * r
    const exitX = cx + ((nx - cx) / outLen) * r
    const exitY = cy + ((ny - cy) / outLen) * r

    path += ` L${entryX} ${entryY} Q${cx} ${cy} ${exitX} ${exitY}`
  }

  if (points.length > 1) {
    const [lastX, lastY] = points[points.length - 1]
    path += ` L${lastX} ${lastY}`
  }

  return path
}
