import { describe, expect, it } from 'vitest'
import type { TftMatchSummary, TftTrait } from '@foxfire/core'
import { summariseTftRecent } from './tftRecent'

const trait = (name: string, style = 2): TftTrait => ({ name, numUnits: 3, style, tierCurrent: style, tierTotal: 4 })

function row(placement: number, queueId = 1100, teamPlacement: number | null = null, traits: TftTrait[] = []): TftMatchSummary {
  return {
    matchId: `NA1_${placement}_${queueId}_${Math.random()}`,
    gameCreation: 0,
    gameDuration: 2000,
    queueId,
    setNumber: 18,
    placement,
    teamPlacement,
    level: 8,
    lastRound: 30,
    timeEliminated: 1800,
    playersEliminated: 0,
    totalDamageToPlayers: 50,
    goldLeft: 0,
    traits,
    units: [],
    augments: [],
    rank: null,
    hasManualRank: false
  }
}

describe('summariseTftRecent', () => {
  it('says nothing for nothing', () => {
    expect(summariseTftRecent([])).toBeNull()
    expect(summariseTftRecent(undefined)).toBeNull()
  })

  it("counts Double Up by the team's place, and the good half by four or two", () => {
    const summary = summariseTftRecent([row(1), row(5), row(3, 1160, 2), row(6, 1160, 3)])!

    expect(summary.games).toBe(4)
    expect(summary.firsts).toBe(1)
    expect(summary.topRate).toBe(0.5)
    expect(summary.averagePlacement).toBe((1 + 5 + 2 + 3) / 4)
    expect(summary.finishes.map((f) => [f.placement, f.top])).toEqual([
      [1, 4],
      [5, 4],
      [2, 2],
      [3, 2]
    ])
  })

  it('names the traits played most, the better average first among equals, and ignores inactive ones', () => {
    const summary = summariseTftRecent([
      row(1, 1100, null, [trait('A'), trait('B'), trait('Off', 0)]),
      row(8, 1100, null, [trait('A'), trait('C')]),
      row(2, 1100, null, [trait('B'), trait('C')])
    ])!

    expect(summary.synergies.map((s) => s.name)).toEqual(['B', 'A', 'C'])
    expect(summary.synergies[0]).toEqual({ name: 'B', games: 2, averagePlacement: 1.5 })
  })

  it('looks only at the window', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row((i % 8) + 1))
    expect(summariseTftRecent(rows, 20)!.games).toBe(20)
  })
})
