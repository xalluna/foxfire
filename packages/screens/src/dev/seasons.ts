import type { Season } from '@foxfire/core'
import { seasonAt } from '@foxfire/core'
import { NOW } from './catalog'

/**
 * The season list the harness runs against.
 *
 * Richer than migration 008 seeds on purpose. The real table starts with one
 * row, which is correct for a fresh install and demonstrates nothing: with a
 * single open-ended season there is no boundary to break a line at, no reset to
 * refuse to attribute, and no second entry in the picker. Three rows exercise
 * all of it.
 *
 * The middle row is the case the flags exist for. A preseason carries rank
 * forward, so it is a period boundary that is *not* a reset — the line breaks
 * there because it is a different period, but LP still attributes across it,
 * and the milestone list still reports a promotion that happened over it.
 * Only the January row resets.
 *
 * Dated relative to NOW so the harness keeps working next year rather than
 * quietly becoming a single-season fixture again.
 */
const YEAR = new Date(NOW).getFullYear()

const at = (year: number, month: number, day: number): number =>
  new Date(year, month, day).getTime()

export const DEV_SEASONS: Season[] = [
  {
    id: 1,
    label: `Season ${YEAR - 1}`,
    startsAt: at(YEAR - 1, 0, 10),
    isPreseason: false,
    resetsRank: true
  },
  {
    id: 2,
    label: `Preseason ${YEAR}`,
    startsAt: at(YEAR - 1, 11, 22),
    isPreseason: true,
    // Rank carries into a preseason — this boundary must not suppress LP.
    resetsRank: false
  },
  {
    id: 3,
    label: `Season ${YEAR}`,
    startsAt: at(YEAR, 0, 8),
    isPreseason: false,
    resetsRank: true
  }
]

/** Stamps a fixture snapshot the way the repo stamps a stored one. */
export function devSeasonIdAt(capturedAt: number): number | null {
  return seasonAt(DEV_SEASONS, capturedAt)?.id ?? null
}
