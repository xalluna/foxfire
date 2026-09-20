import { describe, expect, it } from 'vitest'
import { findMatchForReplay, type FingerprintCandidate } from './fingerprint'

const TEAM = ['Ahri', 'MonkeyKing', 'Thresh', 'Jinx', 'Lee Sin', 'Garen', 'Lux', 'Ezreal', 'Nami', 'Sett']

function candidate(over: Partial<FingerprintCandidate> = {}): FingerprintCandidate {
  return { matchId: 'NA1_1', gameDuration: 1834, championNames: [...TEAM], taken: false, ...over }
}

describe('findMatchForReplay', () => {
  it('matches a game whose roster and length agree', () => {
    const found = findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, [candidate()])
    expect(found).toEqual({ matchId: 'NA1_1', confidence: 1 })
  })

  it('ignores how the two sources capitalise champions', () => {
    const shouty = TEAM.map((name) => name.toUpperCase())
    const found = findMatchForReplay({ championNames: shouty, durationSeconds: 1834 }, [candidate()])
    expect(found?.matchId).toBe('NA1_1')
  })

  it('tolerates a couple of champions it could not resolve', () => {
    const roster = [...TEAM.slice(0, 8), 'Unknown1', 'Unknown2']
    const found = findMatchForReplay({ championNames: roster, durationSeconds: 1834 }, [candidate()])
    expect(found?.confidence).toBeCloseTo(0.8)
  })

  it('refuses a roster that only half agrees', () => {
    const roster = [...TEAM.slice(0, 5), 'A', 'B', 'C', 'D', 'E']
    expect(findMatchForReplay({ championNames: roster, durationSeconds: 1834 }, [candidate()])).toBeNull()
  })

  it('counts a champion picked on both teams twice', () => {
    const mirrored = ['Ahri', 'Ahri', ...TEAM.slice(1, 9)]
    const found = findMatchForReplay(
      { championNames: mirrored, durationSeconds: 1834 },
      [candidate({ championNames: mirrored })]
    )
    expect(found?.confidence).toBe(1)
  })

  it('separates two games on the same champions by length', () => {
    const found = findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, [
      candidate({ matchId: 'NA1_other', gameDuration: 900 }),
      candidate({ matchId: 'NA1_right', gameDuration: 1836 })
    ])
    expect(found?.matchId).toBe('NA1_right')
  })

  it('lets the roster outvote a closer game length', () => {
    const found = findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, [
      candidate({ matchId: 'NA1_closer', gameDuration: 1834, championNames: [...TEAM.slice(0, 8), 'X', 'Y'] }),
      candidate({ matchId: 'NA1_exact', gameDuration: 1860 })
    ])
    expect(found?.matchId).toBe('NA1_exact')
  })

  it('will not claim a match another replay already took', () => {
    expect(findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, [candidate({ taken: true })]))
      .toBeNull()
  })

  it('still matches when the header carried no duration', () => {
    const found = findMatchForReplay({ championNames: [...TEAM], durationSeconds: null }, [
      candidate({ gameDuration: 12 })
    ])
    expect(found?.matchId).toBe('NA1_1')
  })

  it('gives up rather than guessing from length alone', () => {
    expect(findMatchForReplay({ championNames: [], durationSeconds: 1834 }, [candidate()])).toBeNull()
  })

  it('is null with nothing to choose from', () => {
    expect(findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, [])).toBeNull()
  })

  it('does not depend on the order candidates arrive in', () => {
    const list = [candidate({ matchId: 'NA1_a', gameDuration: 1850 }), candidate({ matchId: 'NA1_b', gameDuration: 1834 })]
    const forward = findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, list)
    const backward = findMatchForReplay({ championNames: [...TEAM], durationSeconds: 1834 }, [...list].reverse())
    expect(forward).toEqual(backward)
  })
})
