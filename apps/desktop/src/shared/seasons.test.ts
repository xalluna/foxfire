import { describe, expect, it } from 'vitest'
import type { Season } from './types'
import {
  parseSeasonRange,
  rangeBounds,
  resetsBetween,
  seasonAt,
  seasonBoundsOf,
  seasonRange,
  seasonsSpanning
} from './seasons'

/** Local time throughout, matching how a hand-entered boundary is stored. */
const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m, d, h).getTime()

// The shape the whole feature turns on: two seasons that reset with a preseason
// between them that does not.
const S2025: Season = {
  id: 1,
  label: 'Season 2025',
  startsAt: at(2025, 0, 9),
  isPreseason: false,
  resetsRank: true
}
const PRE2026: Season = {
  id: 2,
  label: 'Preseason 2026',
  startsAt: at(2025, 11, 22),
  isPreseason: true,
  resetsRank: false
}
const S2026: Season = {
  id: 3,
  label: 'Season 2026',
  startsAt: at(2026, 0, 8),
  isPreseason: false,
  resetsRank: true
}
const SEASONS = [S2025, PRE2026, S2026]

describe('seasonAt', () => {
  it('finds the season a moment falls inside', () => {
    expect(seasonAt(SEASONS, at(2025, 5, 1))?.id).toBe(S2025.id)
    expect(seasonAt(SEASONS, at(2025, 11, 28))?.id).toBe(PRE2026.id)
    expect(seasonAt(SEASONS, at(2026, 7, 18))?.id).toBe(S2026.id)
  })

  it('takes effect exactly at the boundary instant', () => {
    expect(seasonAt(SEASONS, S2026.startsAt)?.id).toBe(S2026.id)
    expect(seasonAt(SEASONS, S2026.startsAt - 1)?.id).toBe(PRE2026.id)
  })

  it('reaches backwards forever, so nothing older is stranded', () => {
    // Predates every recorded boundary. Returning null would drop the game out
    // of every period view, which reads as a sync bug rather than as history.
    expect(seasonAt(SEASONS, at(2019, 3, 1))?.id).toBe(S2025.id)
  })

  it('reaches forwards forever, so a boundary nobody has entered cannot cut the season short', () => {
    expect(seasonAt(SEASONS, at(2031, 5, 1))?.id).toBe(S2026.id)
  })

  it('has no answer when nothing is recorded', () => {
    expect(seasonAt([], at(2026, 5, 1))).toBeNull()
  })
})

describe('seasonBoundsOf', () => {
  it('leaves the oldest season open below and the newest open above', () => {
    expect(seasonBoundsOf(SEASONS, S2025.id)).toEqual({ startMs: null, endMs: PRE2026.startsAt })
    expect(seasonBoundsOf(SEASONS, S2026.id)).toEqual({ startMs: S2026.startsAt, endMs: null })
  })

  it('bounds a middle season at both ends, tiling with its neighbours', () => {
    expect(seasonBoundsOf(SEASONS, PRE2026.id)).toEqual({
      startMs: PRE2026.startsAt,
      endMs: S2026.startsAt
    })
  })

  it('returns null for a season that is not in the list', () => {
    expect(seasonBoundsOf(SEASONS, 999)).toBeNull()
  })
})

describe('resetsBetween', () => {
  it('fires across a boundary that reset the ladder', () => {
    expect(resetsBetween(SEASONS, at(2025, 11, 30), at(2026, 0, 12))).toBe(true)
  })

  it('does not fire across a boundary that carried rank forward', () => {
    // Season 2025 into its preseason. This is the whole reason the flag exists
    // separately from the boundary: a game here still earned its LP.
    expect(resetsBetween(SEASONS, at(2025, 11, 20), at(2025, 11, 24))).toBe(false)
  })

  it('does not fire inside one season', () => {
    expect(resetsBetween(SEASONS, at(2026, 2, 1), at(2026, 2, 2))).toBe(false)
  })

  it('is exclusive below and inclusive above, matching how snapshot pairs are read', () => {
    expect(resetsBetween(SEASONS, S2026.startsAt, S2026.startsAt + 1000)).toBe(false)
    expect(resetsBetween(SEASONS, S2026.startsAt - 1000, S2026.startsAt)).toBe(true)
  })

  it('cannot fire with nothing recorded', () => {
    // The cost of hand-entered boundaries: with no seasons there is no reset to
    // know about, so the guard cannot protect anything.
    expect(resetsBetween([], at(2025, 11, 30), at(2026, 0, 12))).toBe(false)
  })
})

describe('season range encoding', () => {
  it('round-trips an id', () => {
    expect(parseSeasonRange(seasonRange(12))).toBe(12)
  })

  it('prefixes, so it cannot collide with a relative range', () => {
    expect(seasonRange(12)).toBe('season:12')
  })

  it('returns null for the relative ranges', () => {
    expect(parseSeasonRange('7d')).toBeNull()
    expect(parseSeasonRange('30d')).toBeNull()
    expect(parseSeasonRange('all')).toBeNull()
  })

  it('rejects a malformed period rather than reading it as id zero', () => {
    expect(parseSeasonRange('season:' as never)).toBeNull()
    expect(parseSeasonRange('season:abc' as never)).toBeNull()
  })
})

describe('rangeBounds', () => {
  const NOW = at(2026, 7, 18)

  it('leaves both ends open for all-time', () => {
    expect(rangeBounds('all', SEASONS, NOW)).toEqual({ sinceMs: null, untilMs: null })
  })

  it('gives the relative ranges a start but no end', () => {
    expect(rangeBounds('7d', SEASONS, NOW)).toEqual({
      sinceMs: NOW - 7 * 86_400_000,
      untilMs: null
    })
  })

  it('bounds a middle season at both ends', () => {
    expect(rangeBounds(seasonRange(PRE2026.id), SEASONS, NOW)).toEqual({
      sinceMs: PRE2026.startsAt,
      untilMs: S2026.startsAt
    })
  })

  it('shows everything for a season since deleted, rather than an empty screen', () => {
    expect(rangeBounds(seasonRange(999), SEASONS, NOW)).toEqual({ sinceMs: null, untilMs: null })
  })
})

describe('seasonsSpanning', () => {
  it('lists newest first', () => {
    expect(seasonsSpanning(SEASONS, at(2025, 5, 1), at(2026, 5, 1)).map((s) => s.id)).toEqual([
      S2026.id,
      PRE2026.id,
      S2025.id
    ])
  })

  it('keeps a season with no games rather than leaving a hole in the picker', () => {
    // Nothing was played during the preseason, but omitting it would read as
    // lost data between two seasons that do have games.
    const span = seasonsSpanning(SEASONS, at(2025, 5, 1), at(2026, 5, 1))
    expect(span.map((s) => s.label)).toContain('Preseason 2026')
  })

  it('returns the single season a short span sits inside', () => {
    expect(seasonsSpanning(SEASONS, at(2026, 2, 1), at(2026, 6, 1)).map((s) => s.id)).toEqual([
      S2026.id
    ])
  })

  it('is empty when nothing is recorded', () => {
    expect(seasonsSpanning([], at(2026, 2, 1), at(2026, 6, 1))).toEqual([])
  })
})
