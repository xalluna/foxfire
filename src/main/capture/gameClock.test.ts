import { describe, expect, it } from 'vitest'
import { CLOCK_ADVANCE_S, isClockRunning } from './gameClock'

describe('isClockRunning', () => {
  it('does not start on a single reading, however plausible', () => {
    expect(isClockRunning(null, 0)).toBe(false)
    expect(isClockRunning(null, 600)).toBe(false)
  })

  it('holds through the loading screen, where the clock does not move', () => {
    // Measured on a real ARAM: the API answered for 243 seconds with gameTime
    // sitting at 0.027, which is what made every marker four minutes early.
    expect(isClockRunning(0.027, 0.027)).toBe(false)
    expect(isClockRunning(0, 0)).toBe(false)
  })

  it('is not fooled by the small non-zero value the API reports while loading', () => {
    // 0.027 > 0, so a bare "is it above zero" check would have started here.
    expect(isClockRunning(0, 0.027)).toBe(false)
  })

  it('starts once the clock ticks', () => {
    // Two seconds between polls, so a live game advances by about two seconds.
    expect(isClockRunning(0.027, 2.1)).toBe(true)
  })

  it('starts on a reconnect into a game already well under way', () => {
    expect(isClockRunning(842.2, 844.3)).toBe(true)
  })

  it('needs a real tick, not jitter', () => {
    expect(isClockRunning(10, 10 + CLOCK_ADVANCE_S - 0.01)).toBe(false)
    expect(isClockRunning(10, 10 + CLOCK_ADVANCE_S)).toBe(true)
  })

  it('does not treat the clock going backwards as running', () => {
    // Should not happen, but a reading that regresses must not start a
    // recording whose offset would then be wrong in the other direction.
    expect(isClockRunning(600, 10)).toBe(false)
  })
})
