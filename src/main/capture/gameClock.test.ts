import { describe, expect, it } from 'vitest'
import {
  CLOCK_ADVANCE_S,
  containsGameStart,
  gameReadiness,
  isClockRunning,
  READY_FALLBACK_MS,
  type ReadinessInput
} from './gameClock'

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    previousGameTime: null,
    gameTime: 0,
    sawGameStart: false,
    answeringForMs: 0,
    ...over
  }
}

describe('gameReadiness', () => {
  it('waits through the loading screen, where the API answers but nothing has started', () => {
    // Measured on a real ARAM: 243 seconds of this, clock sitting at 0.027.
    expect(
      gameReadiness(input({ previousGameTime: 0.027, gameTime: 0.027, answeringForMs: 200_000 }))
    ).toBe('wait')
  })

  it('starts on the clock advancing', () => {
    expect(gameReadiness(input({ previousGameTime: 0.027, gameTime: 2.1 }))).toBe('clock')
  })

  it('starts on the game saying so, even with the clock stuck at zero', () => {
    // The failure this exists for: gameTime is optional in the payload and the
    // mapper defaults it to 0, so a game that omits it never advances and
    // nothing was recorded at all.
    expect(
      gameReadiness(input({ previousGameTime: 0, gameTime: 0, sawGameStart: true }))
    ).toBe('event')
  })

  it('prefers the game saying so over inferring it from the clock', () => {
    const both = gameReadiness(
      input({ previousGameTime: 0, gameTime: 5, sawGameStart: true })
    )

    // Both would start it; the explicit signal is the one worth logging.
    expect(both).toBe('event')
  })

  it('records anyway rather than miss a game when both signals fail', () => {
    expect(
      gameReadiness(input({ previousGameTime: 0, gameTime: 0, answeringForMs: READY_FALLBACK_MS }))
    ).toBe('fallback')
  })

  it('does not let the backstop fire during an ordinary slow load', () => {
    // The longest loading screen actually seen was 243 seconds.
    expect(
      gameReadiness(input({ previousGameTime: 0, gameTime: 0, answeringForMs: 243_000 }))
    ).toBe('wait')
  })

  it('starts on a reconnect into a game already under way', () => {
    expect(gameReadiness(input({ previousGameTime: 842.2, gameTime: 844.3 }))).toBe('clock')
  })

  it('never starts on the first reading alone', () => {
    expect(gameReadiness(input({ previousGameTime: null, gameTime: 600 }))).toBe('wait')
  })
})

describe('isClockRunning', () => {
  it('needs two readings', () => {
    expect(isClockRunning(null, 600)).toBe(false)
  })

  it('needs a real tick, not jitter', () => {
    expect(isClockRunning(10, 10 + CLOCK_ADVANCE_S - 0.01)).toBe(false)
    expect(isClockRunning(10, 10 + CLOCK_ADVANCE_S)).toBe(true)
  })

  it('does not treat the clock going backwards as running', () => {
    expect(isClockRunning(600, 10)).toBe(false)
  })
})

describe('containsGameStart', () => {
  it('finds the event by name', () => {
    expect(containsGameStart([{ EventName: 'GameStart', EventID: 0 }])).toBe(true)
  })

  it('finds it by its fixed id, in case the name is ever spelled differently', () => {
    expect(containsGameStart([{ EventID: 0 }])).toBe(true)
  })

  it('is not fooled by the events of a game already running', () => {
    expect(
      containsGameStart([
        { EventName: 'ChampionKill', EventID: 12 },
        { EventName: 'TurretKilled', EventID: 14 }
      ])
    ).toBe(false)
  })

  it('copes with an empty feed, which is what loading returns', () => {
    expect(containsGameStart([])).toBe(false)
  })
})
