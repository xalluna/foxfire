import { describe, expect, it } from 'vitest'
import type { Season } from '@foxfire/core'
import { championRangeFor } from './championStats'

const season = (id: number): Season => ({
  id,
  label: `Season ${id}`,
  startsAt: id * 1_000,
  isPreseason: false,
  resetsRank: true
})

describe('championRangeFor', () => {
  it('keeps a period somebody picked', () => {
    expect(championRangeFor('all', [season(3)])).toBe('all')
    expect(championRangeFor('season:1', [season(3), season(1)])).toBe('season:1')
  })

  it('opens on the newest season with games, which the periods list first', () => {
    expect(championRangeFor(null, [season(3), season(2)])).toBe('season:3')
  })

  it('falls back to everything with no seasons at all, or none loaded yet', () => {
    // The stats query waits for the periods, so the second never reaches the
    // server — but it has to be something to build a key from.
    expect(championRangeFor(null, [])).toBe('all')
    expect(championRangeFor(null, undefined)).toBe('all')
  })
})
