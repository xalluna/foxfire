import { describe, expect, it } from 'vitest'
import { compactNumber, formatPercent, kdaRatio, perMinute } from './matchStats'

describe('compactNumber', () => {
  it('leaves values under a thousand alone', () => {
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(999)).toBe('999')
  })

  it('switches to thousands at exactly 1000', () => {
    expect(compactNumber(1000)).toBe('1.0k')
    expect(compactNumber(18_900)).toBe('18.9k')
  })

  it('keeps one decimal so the column stays a fixed width', () => {
    expect(compactNumber(11_249)).toBe('11.2k')
    expect(compactNumber(1_000_000)).toBe('1000.0k')
  })

  it('renders null as a dash rather than zero', () => {
    // Zero gold and unknown gold are different claims.
    expect(compactNumber(null)).toBe('—')
  })
})

describe('perMinute', () => {
  it('divides the total by the duration in minutes', () => {
    expect(perMinute(300, 3600)).toBeCloseTo(5, 5)
    expect(perMinute(243, 1669)).toBeCloseTo(8.736, 3)
  })

  it('returns null rather than dividing by zero', () => {
    expect(perMinute(200, 0)).toBeNull()
    // Riot has shipped negative durations for aborted games.
    expect(perMinute(200, -60)).toBeNull()
  })

  it('propagates a null total', () => {
    expect(perMinute(null, 1800)).toBeNull()
  })
})

describe('kdaRatio', () => {
  it('names a deathless record instead of reporting infinity', () => {
    expect(kdaRatio(5, 0, 7)).toBe('Perfect')
  })

  it('counts assists toward the ratio', () => {
    expect(kdaRatio(2, 4, 4)).toBe('1.50')
    expect(kdaRatio(10, 6, 10)).toBe('3.33')
  })

  it('reports a scoreless game as 0.00, which is a real result', () => {
    expect(kdaRatio(0, 3, 0)).toBe('0.00')
  })
})

describe('formatPercent', () => {
  it('rounds a 0–1 ratio to whole percent', () => {
    expect(formatPercent(0.225)).toBe('23%')
    expect(formatPercent(1)).toBe('100%')
  })

  it('renders null as a dash', () => {
    expect(formatPercent(null)).toBe('—')
  })
})
