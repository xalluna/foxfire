import { describe, expect, it } from 'vitest'
import { countdownLabel, secondsUntil } from './cooldown'

const NOW = Date.parse('2026-09-24T20:00:00Z')

describe('secondsUntil', () => {
  it('rounds up, so the last second still shows', () => {
    expect(secondsUntil('2026-09-24T20:01:31Z', NOW)).toBe(91)
    expect(secondsUntil('2026-09-24T20:00:00.200Z', NOW)).toBe(1)
  })

  it('reads the server’s own spelling of a time', () => {
    expect(secondsUntil('2026-09-24T20:02:00.0000000+00:00', NOW)).toBe(120)
  })

  it('is zero once the wait is over, or when there is none', () => {
    expect(secondsUntil('2026-09-24T20:00:00Z', NOW)).toBe(0)
    expect(secondsUntil('2026-09-24T19:58:00Z', NOW)).toBe(0)
    expect(secondsUntil(null, NOW)).toBe(0)
    expect(secondsUntil('not a time', NOW)).toBe(0)
  })
})

describe('countdownLabel', () => {
  it('reads as minutes and seconds', () => {
    expect(countdownLabel(91)).toBe('1:31')
    expect(countdownLabel(120)).toBe('2:00')
    expect(countdownLabel(5)).toBe('0:05')
    expect(countdownLabel(0)).toBe('0:00')
  })
})
