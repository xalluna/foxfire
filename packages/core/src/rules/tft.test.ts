import { describe, expect, it } from 'vitest'
import {
  activeTraits,
  countedPlacement,
  isTopHalf,
  ordinal,
  stageOfRound,
  strongestTrait,
  teamPlacements,
  tftDisplayName,
  tftGameEndMs,
  unitCost
} from './tft'
import type { TftTrait } from '../types'

describe('stageOfRound', () => {
  it('counts four rounds in stage 1 and seven in every stage after', () => {
    expect(stageOfRound(1, 1100)).toEqual({ stage: 1, round: 1 })
    expect(stageOfRound(4, 1100)).toEqual({ stage: 1, round: 4 })
    // Riot's own example: knocked out at 2-1 is a last_round of 5.
    expect(stageOfRound(5, 1100)).toEqual({ stage: 2, round: 1 })
    expect(stageOfRound(11, 1100)).toEqual({ stage: 2, round: 7 })
    expect(stageOfRound(12, 1100)).toEqual({ stage: 3, round: 1 })
    expect(stageOfRound(37, 1100)).toEqual({ stage: 6, round: 5 })
  })

  it('declines Hyper Roll, and anything that is not a round', () => {
    expect(stageOfRound(20, 1130)).toBeNull()
    expect(stageOfRound(0, 1100)).toBeNull()
    expect(stageOfRound(2.5, 1100)).toBeNull()
  })
})

describe('ordinal', () => {
  it('says places the way a person does', () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '8th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd'
    ])
  })
})

describe('teamPlacements', () => {
  it('ranks teams by their best member, whichever way Riot reports Double Up', () => {
    const individual = [
      { puuid: 'a', placement: 1, partnerGroupId: 3 },
      { puuid: 'b', placement: 2, partnerGroupId: 3 },
      { puuid: 'c', placement: 3, partnerGroupId: 1 },
      { puuid: 'd', placement: 5, partnerGroupId: 1 },
      { puuid: 'e', placement: 4, partnerGroupId: 2 },
      { puuid: 'f', placement: 8, partnerGroupId: 2 },
      { puuid: 'g', placement: 6, partnerGroupId: 4 },
      { puuid: 'h', placement: 7, partnerGroupId: 4 }
    ]
    expect(Object.fromEntries(teamPlacements(individual))).toEqual({
      a: 1,
      b: 1,
      c: 2,
      d: 2,
      e: 3,
      f: 3,
      g: 4,
      h: 4
    })

    const shared = individual.map((p) => ({ ...p, placement: Math.ceil(p.placement / 2) }))
    expect(teamPlacements(shared).get('e')).toBe(3)
  })

  it('leaves out a player with no team', () => {
    expect(teamPlacements([{ puuid: 'solo', placement: 1, partnerGroupId: null }]).size).toBe(0)
  })
})

describe('the top half', () => {
  it('is a top four, or a top-two team in Double Up', () => {
    expect(isTopHalf({ placement: 4, teamPlacement: null }, 1100)).toBe(true)
    expect(isTopHalf({ placement: 5, teamPlacement: null }, 1100)).toBe(false)
    expect(isTopHalf({ placement: 4, teamPlacement: 2 }, 1160)).toBe(true)
    expect(isTopHalf({ placement: 3, teamPlacement: 3 }, 1160)).toBe(false)
    expect(countedPlacement({ placement: 4, teamPlacement: 2 }, 1160)).toBe(2)
    expect(countedPlacement({ placement: 4, teamPlacement: 2 }, 1100)).toBe(4)
  })
})

describe('traits', () => {
  const trait = (name: string, style: number, numUnits: number): TftTrait => ({
    name,
    style,
    numUnits,
    tierCurrent: style,
    tierTotal: 4
  })

  it('lists the active ones strongest first, and the same way every time', () => {
    const board = [trait('B', 1, 2), trait('Off', 0, 1), trait('A', 3, 4), trait('C', 1, 3), trait('D', 1, 3)]
    expect(activeTraits(board).map((t) => t.name)).toEqual(['A', 'C', 'D', 'B'])
    expect(strongestTrait(board)?.name).toBe('A')
    expect(strongestTrait([trait('Off', 0, 1)])).toBeNull()
  })
})

describe('names and costs', () => {
  it('reads a name out of a Riot id', () => {
    expect(tftDisplayName('TFT13_Jinx')).toBe('Jinx')
    expect(tftDisplayName('TFT_Item_InfinityEdge')).toBe('Infinity Edge')
    expect(tftDisplayName('TFT13_Augment_PandorasItems')).toBe('Pandoras Items')
    expect(tftDisplayName('TFT9b_Bilgewater')).toBe('Bilgewater')
    expect(tftDisplayName('Set13_Ambusher')).toBe('Ambusher')
  })

  it('maps rarity onto cost, skipping the numbers Riot skips', () => {
    expect([0, 1, 2, 4, 6].map(unitCost)).toEqual([1, 2, 3, 4, 5])
    expect(unitCost(9)).toBe(5)
  })
})

describe('tftGameEndMs', () => {
  it('places a game at its player’s own elimination', () => {
    expect(tftGameEndMs(1_000_000, 900.4, 2_100)).toBe(1_000_000 + 900_400)
    expect(tftGameEndMs(1_000_000, null, 2_100)).toBe(1_000_000 + 2_100_000)
  })
})
