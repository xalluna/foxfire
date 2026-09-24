/**
 * Whole seconds from `now` until `until`, rounded up so the last second still
 * reads 0:01 rather than 0:00 — the button comes back at zero, not a second
 * before it. Zero for no time, a time already past, or one that does not
 * parse.
 */
export function secondsUntil(until: string | null, now: number): number {
  if (until === null) return 0
  const ms = Date.parse(until) - now
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
}

/** "1:31", "0:05" — a wait of minutes, read at a glance. */
export function countdownLabel(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
