import { describe, expect, it } from 'vitest'
import { EXAMPLE_RIOT_IDS, randomExampleRiotId } from './exampleRiotId'
import { parseRiotId } from './riotId'

describe('EXAMPLE_RIOT_IDS', () => {
  it('offers a pool worth rotating through', () => {
    expect(EXAMPLE_RIOT_IDS.length).toBeGreaterThan(1)
    expect(new Set(EXAMPLE_RIOT_IDS).size).toBe(EXAMPLE_RIOT_IDS.length)
  })

  it('holds only IDs the app itself would accept', () => {
    // A typo'd entry would ship a placeholder that fails the very validation it
    // is demonstrating.
    for (const id of EXAMPLE_RIOT_IDS) {
      const parsed = parseRiotId(id)
      expect(parsed, id).not.toBeNull()
      expect(parsed?.gameName).toBeTruthy()
      expect(parsed?.tagLine).toBeTruthy()
    }
  })
})

describe('randomExampleRiotId', () => {
  it('always returns a member of the pool', () => {
    for (let i = 0; i < 100; i++) {
      expect(EXAMPLE_RIOT_IDS).toContain(randomExampleRiotId())
    }
  })
})
