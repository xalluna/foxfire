/**
 * When YouTube's daily quota comes back: midnight, Pacific time.
 *
 * Worked out with the platform's own time zone data rather than a fixed
 * offset, because Pacific time moves an hour twice a year and a queue that
 * waited until 07:00 UTC in November would wait an hour past the reset.
 */

const ZONE = 'America/Los_Angeles'

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23'
})

function wallClock(epochMs: number): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(epochMs)).map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!
  }
}

/** Pacific time minus UTC at an instant, in milliseconds: −7h in summer, −8h in winter. */
function offsetAt(epochMs: number): number {
  const wall = wallClock(epochMs)
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
  return asUtc - Math.floor(epochMs / 1000) * 1000
}

/** The next midnight in Pacific time after `now`, as epoch milliseconds. */
export function nextPacificMidnight(now: number): number {
  const today = wallClock(now)
  // Midnight tomorrow, written as if it were UTC, then moved by the offset in
  // force at that moment — asked twice, because the offset that applies is the
  // one at the answer, which on the night the clocks change is not the one now.
  const wall = Date.UTC(today.year, today.month - 1, today.day + 1, 0, 0, 0)
  const first = wall - offsetAt(wall)
  return wall - offsetAt(first)
}
