/**
 * Statistics shared between the read queries and the rollup job.
 *
 * Deliberately dependency-free so retention.ts can use it without pulling in
 * the telemetry entry point, which would close an import cycle.
 */

/** Nearest-rank percentile. Copies, so the caller's array is never reordered. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

export function minOf(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values)
}

export function maxOf(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values)
}
