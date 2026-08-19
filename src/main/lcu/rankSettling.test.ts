import { describe, expect, it } from 'vitest'
import { isSettled, pendingReadingFor, RANK_SETTLE_MS } from './rankSettling'

const SOLO = 'RANKED_SOLO_5x5' as const
const FLEX = 'RANKED_FLEX_SR' as const
const T0 = 1_700_000_000_000

/** The watcher's connected poll interval, which the window has to outlast. */
const POLL_MS = 10_000

describe('isSettled', () => {
  it('does not force when no ranked game is waiting', () => {
    expect(isSettled(null, SOLO, T0)).toBe(false)
  })

  it('holds the snapshot back while the reading may still be stale', () => {
    const pending = pendingReadingFor(SOLO, T0)

    // The tick that spotted the end of the game, and the several that follow it.
    expect(isSettled(pending, SOLO, T0)).toBe(false)
    expect(isSettled(pending, SOLO, T0 + POLL_MS)).toBe(false)
    expect(isSettled(pending, SOLO, T0 + RANK_SETTLE_MS - 1)).toBe(false)
  })

  it('believes a reading that is still unchanged once the window closes', () => {
    const pending = pendingReadingFor(SOLO, T0)

    expect(isSettled(pending, SOLO, T0 + RANK_SETTLE_MS)).toBe(true)
    expect(isSettled(pending, SOLO, T0 + RANK_SETTLE_MS + POLL_MS)).toBe(true)
  })

  it('waits only on the ladder the game was played on', () => {
    const pending = pendingReadingFor(SOLO, T0)

    // A solo game must never force a flex row. Flex has its own open interval,
    // and closing it at a value nothing measured costs whatever game sits in it.
    expect(isSettled(pending, FLEX, T0 + RANK_SETTLE_MS)).toBe(false)
  })

  it('gives the client several polls to catch up', () => {
    // The lag seen in practice was one poll. Anything less than a couple of
    // polls here would put the force back on the same tick that reads a stale
    // value, which is the whole bug.
    expect(RANK_SETTLE_MS).toBeGreaterThanOrEqual(POLL_MS * 3)
  })
})
