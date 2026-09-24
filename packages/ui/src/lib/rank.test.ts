import { describe, expect, it } from 'vitest'
import { tierProgress } from './rank'

describe('tierProgress', () => {
  it('walks the four divisions to the next tier', () => {
    const progress = tierProgress({ tier: 'DIAMOND', rank: 'IV', leaguePoints: 80 })

    expect(progress?.stops.map((s) => s.label)).toEqual(['D4', 'D3', 'D2', 'D1', 'M'])
    expect(progress?.stops.at(-1)?.tier).toBe('MASTER')
    expect(progress?.current).toBe(0)
    expect(progress?.fraction).toBe(0.2)
  })

  it('places LP inside its division', () => {
    const progress = tierProgress({ tier: 'GOLD', rank: 'II', leaguePoints: 50 })

    expect(progress?.stops.map((s) => s.label)).toEqual(['G4', 'G3', 'G2', 'G1', 'P'])
    expect(progress?.current).toBe(2)
    expect(progress?.fraction).toBe(0.625)
  })

  it('keeps LP to the division it belongs to', () => {
    // 100 LP is a promotion series, still in Gold I rather than past it.
    expect(tierProgress({ tier: 'GOLD', rank: 'I', leaguePoints: 100 })?.fraction).toBe(1)
    expect(tierProgress({ tier: 'GOLD', rank: 'IV', leaguePoints: -5 })?.fraction).toBe(0)
    expect(tierProgress({ tier: 'GOLD', rank: 'IV', leaguePoints: null })?.fraction).toBe(0)
  })

  it('has no track for the apex tiers or for nobody', () => {
    expect(tierProgress({ tier: 'MASTER', rank: 'I', leaguePoints: 240 })).toBeNull()
    expect(tierProgress({ tier: 'CHALLENGER', rank: 'I', leaguePoints: 1400 })).toBeNull()
    expect(tierProgress({ tier: null, rank: null, leaguePoints: null })).toBeNull()
  })
})
