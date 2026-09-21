/**
 * Ranked seasons, and the arithmetic over them.
 *
 * The boundaries are entered by hand and stored in the `seasons` table — see
 * migration 008 for why there is nothing to derive them from. Riot publishes no
 * way to ask which season is current, and the calendar is not a stand-in for
 * one: 2026 opened on 8 January, and a preseason can run into February.
 *
 * Everything here is a pure function of a season list plus a timestamp. No
 * ambient state and no database access, so the same code answers the same way
 * in the desktop's main process, in a test against a literal list, and in the
 * dev harness. The screens never call most of it — snapshots arrive already
 * stamped with a seasonId — but the range helpers are shared.
 *
 * Every list passed in must be ordered oldest first. listSeasons guarantees it.
 */

import type { RankRange, Season } from '../types'

const DAY_MS = 86_400_000

const SEASON_PREFIX = 'season:'

/** Matches an encoded period exactly, so `season:` alone cannot parse as id 0. */
const SEASON_RANGE = /^season:(\d+)$/

/**
 * The season a moment falls in, or null when the list is empty.
 *
 * The oldest season reaches backwards forever and the newest reaches forwards
 * forever, so with at least one row every moment has an answer. That is what
 * keeps a missing future boundary from cutting the current season short, and
 * stops history older than the first recorded boundary from vanishing out of
 * every period view.
 */
export function seasonAt(seasons: Season[], ms: number): Season | null {
  if (seasons.length === 0) return null

  // Walk backwards: the answer is the newest season that had already started,
  // and falling off the front means "older than anything recorded", which the
  // oldest season absorbs.
  for (let i = seasons.length - 1; i > 0; i--) {
    if (ms >= seasons[i].startsAt) return seasons[i]
  }
  return seasons[0]
}

/** Half-open bounds of one season. `endMs` is null for the current one. */
export function seasonBoundsOf(
  seasons: Season[],
  id: number
): { startMs: number | null; endMs: number | null } | null {
  const index = seasons.findIndex((s) => s.id === id)
  if (index < 0) return null

  return {
    // The oldest season is unbounded below so nothing older is stranded.
    startMs: index === 0 ? null : seasons[index].startsAt,
    endMs: index === seasons.length - 1 ? null : seasons[index + 1].startsAt
  }
}

/**
 * Whether the ladder was reset between two moments.
 *
 * The guard that keeps a reset from being recorded as a game that lost two
 * thousand LP — see attributeInterval and getRankMilestones.
 *
 * Deliberately not "are these in the same season". A season boundary and a
 * ladder reset are different events: rank carries into a preseason, and Riot
 * has reset mid-year without one. Only a boundary that actually reset counts,
 * so a game either side of a carry-over boundary still gets its LP.
 *
 * The interval is exclusive below and inclusive above, matching how a snapshot
 * pair is read everywhere else.
 */
export function resetsBetween(seasons: Season[], afterMs: number, untilMs: number): boolean {
  return seasons.some((s) => s.resetsRank && s.startsAt > afterMs && s.startsAt <= untilMs)
}

/** A season as a RankRange, which is how a selected period travels to whichever client answers. */
export function seasonRange(id: number): RankRange {
  return `${SEASON_PREFIX}${id}`
}

/** The season id a range names, or null when it is one of the relative ranges. */
export function parseSeasonRange(range: RankRange): number | null {
  const match = SEASON_RANGE.exec(range)
  return match ? Number(match[1]) : null
}

/**
 * A range as the window it selects.
 *
 * The single place a RankRange becomes numbers, so the rank graph and the
 * champion table can never disagree about what a season covers.
 *
 * Both bounds are epoch milliseconds passed to SQL as bind parameters, never a
 * strftime expression: strftime resolves in UTC while a hand-entered boundary
 * is local, and the two would put a changeover-day game in different seasons on
 * different screens.
 */
export function rangeBounds(
  range: RankRange,
  seasons: Season[] = [],
  now: number = Date.now()
): { sinceMs: number | null; untilMs: number | null } {
  if (range === 'all') return { sinceMs: null, untilMs: null }
  if (range === '7d') return { sinceMs: now - 7 * DAY_MS, untilMs: null }
  if (range === '30d') return { sinceMs: now - 30 * DAY_MS, untilMs: null }

  const id = parseSeasonRange(range)
  // An unparseable range, or one naming a season since deleted, shows
  // everything rather than nothing — a better failure than an empty screen.
  if (id === null) return { sinceMs: null, untilMs: null }

  const bounds = seasonBoundsOf(seasons, id)
  if (!bounds) return { sinceMs: null, untilMs: null }

  return { sinceMs: bounds.startMs, untilMs: bounds.endMs }
}

/**
 * The seasons a span of history touches, newest first.
 *
 * Contiguous by construction, so this is a slice rather than a filter: every
 * season between the one holding the oldest record and the one holding the
 * newest is included, whether or not it has games in it. A season the user sat
 * out still belongs in the picker; a hole there reads as lost data.
 */
export function seasonsSpanning(seasons: Season[], oldestMs: number, newestMs: number): Season[] {
  const first = seasonAt(seasons, oldestMs)
  const last = seasonAt(seasons, newestMs)
  if (!first || !last) return []

  const from = seasons.findIndex((s) => s.id === first.id)
  const to = seasons.findIndex((s) => s.id === last.id)
  return seasons.slice(from, to + 1).reverse()
}
