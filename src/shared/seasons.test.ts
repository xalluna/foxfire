import { describe, expect, it } from 'vitest'
import {
  parseSeasonRange,
  rangeBounds,
  sameSeason,
  seasonBounds,
  seasonLabel,
  seasonOf,
  seasonRange,
  seasonsBetween
} from './seasons'

/** Local time throughout, matching how seasonBounds decides a boundary. */
const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m, d, h).getTime()

describe('seasonOf', () => {
  it('reports the calendar year a moment falls in', () => {
    expect(seasonOf(at(2026, 7, 18))).toBe(2026)
    expect(seasonOf(at(2025, 11, 31, 23))).toBe(2025)
  })

  it('turns over exactly at local midnight on January 1', () => {
    const boundary = new Date(2027, 0, 1).getTime()
    expect(seasonOf(boundary - 1)).toBe(2026)
    expect(seasonOf(boundary)).toBe(2027)
  })
})

describe('seasonBounds', () => {
  it('is half-open, so adjacent years tile without overlapping', () => {
    const y2026 = seasonBounds(2026)
    const y2027 = seasonBounds(2027)
    expect(y2026.endMs).toBe(y2027.startMs)
  })

  it('places the instant of the boundary in the later year', () => {
    const { startMs, endMs } = seasonBounds(2026)
    expect(seasonOf(startMs)).toBe(2026)
    expect(seasonOf(endMs)).toBe(2027)
    expect(seasonOf(endMs - 1)).toBe(2026)
  })
})

describe('sameSeason', () => {
  it('separates December from the January after it', () => {
    expect(sameSeason(at(2026, 11, 31), at(2027, 0, 8))).toBe(false)
  })

  it('holds across the whole of one year, including Riot split boundaries', () => {
    // Riot's own Season 2 to Season 3 change lands in July and resets nothing,
    // so it must not read as a period boundary here.
    expect(sameSeason(at(2026, 6, 28), at(2026, 6, 29))).toBe(true)
    expect(sameSeason(at(2026, 0, 1), at(2026, 11, 31))).toBe(true)
  })
})

describe('season range encoding', () => {
  it('round-trips a year', () => {
    expect(parseSeasonRange(seasonRange(2026))).toBe(2026)
  })

  it('encodes with a prefix so it cannot collide with a relative range', () => {
    expect(seasonRange(2026)).toBe('season:2026')
  })

  it('returns null for the relative ranges', () => {
    expect(parseSeasonRange('7d')).toBeNull()
    expect(parseSeasonRange('30d')).toBeNull()
    expect(parseSeasonRange('all')).toBeNull()
  })

  it('rejects a malformed period rather than reading it as year zero', () => {
    // Number('') is 0 and Number.isInteger(0) is true, so a bare prefix would
    // parse as a real year under a looser check.
    expect(parseSeasonRange('season:' as never)).toBeNull()
    expect(parseSeasonRange('season:abc' as never)).toBeNull()
    expect(parseSeasonRange('season:20260' as never)).toBeNull()
  })
})

describe('rangeBounds', () => {
  const NOW = at(2026, 7, 18)

  it('leaves both ends open for all-time', () => {
    expect(rangeBounds('all', NOW)).toEqual({ sinceMs: null, untilMs: null })
  })

  it('gives the relative ranges a start but no end', () => {
    expect(rangeBounds('7d', NOW)).toEqual({ sinceMs: NOW - 7 * 86_400_000, untilMs: null })
    expect(rangeBounds('30d', NOW)).toEqual({ sinceMs: NOW - 30 * 86_400_000, untilMs: null })
  })

  it('bounds a period at both ends', () => {
    const { startMs, endMs } = seasonBounds(2025)
    expect(rangeBounds(seasonRange(2025), NOW)).toEqual({ sinceMs: startMs, untilMs: endMs })
  })

  it('falls back to all-time on an unparseable range rather than showing nothing', () => {
    expect(rangeBounds('season:oops' as never, NOW)).toEqual({ sinceMs: null, untilMs: null })
  })
})

describe('seasonsBetween', () => {
  it('lists newest first', () => {
    expect(seasonsBetween(at(2024, 2, 1), at(2026, 7, 1))).toEqual([2026, 2025, 2024])
  })

  it('returns the single year a span sits inside', () => {
    expect(seasonsBetween(at(2026, 0, 2), at(2026, 11, 30))).toEqual([2026])
  })

  it('keeps a year with no games rather than leaving a hole in the picker', () => {
    // 2025 has nothing in it, but omitting it would read as data loss.
    expect(seasonsBetween(at(2024, 5, 1), at(2026, 5, 1))).toEqual([2026, 2025, 2024])
  })
})

describe('seasonLabel', () => {
  it('names the year the way the picker shows it', () => {
    expect(seasonLabel(2026)).toBe('Season 2026')
  })
})
