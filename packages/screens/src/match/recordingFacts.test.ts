import { describe, expect, it } from 'vitest'
import type { TftMatchSummary } from '@foxfire/core'
import { isTftRow, tftHeaderFactsFor } from './recordingFacts'

/**
 * What a TFT recording's header says: the place that moved LP, the board's
 * strongest trait and its carry, and the player's own game length.
 */
const GAME: TftMatchSummary = {
  matchId: 'NA1_7400000000',
  gameCreation: 1_790_000_000_000,
  gameDuration: 2_300,
  queueId: 1100,
  setNumber: 18,
  placement: 3,
  teamPlacement: null,
  level: 8,
  lastRound: 33,
  timeEliminated: 2_004,
  playersEliminated: 1,
  totalDamageToPlayers: 98,
  goldLeft: 4,
  traits: [
    { name: 'TFT18_Defender', numUnits: 2, style: 1, tierCurrent: 1, tierTotal: 3 },
    { name: 'TFT18_FloraFatalis', numUnits: 5, style: 3, tierCurrent: 2, tierTotal: 4 },
    { name: 'TFT18_Summoner', numUnits: 1, style: 0, tierCurrent: 0, tierTotal: 3 }
  ],
  units: [
    { characterId: 'TFT18_Poppy', tier: 3, rarity: 0, items: [] },
    { characterId: 'TFT18_Jinx', tier: 2, rarity: 4, items: ['TFT_Item_InfinityEdge'] },
    { characterId: 'TFT18_Xayah', tier: 2, rarity: 6, items: [] },
    { characterId: 'TFT18_Karma', tier: 2, rarity: 6, items: ['TFT_Item_JeweledGauntlet', 'TFT_Item_Bloodthirster'] }
  ],
  augments: [],
  rank: null,
  hasManualRank: false,
  recording: null
}

describe('tftHeaderFactsFor', () => {
  it('names the board by its strongest trait and its most expensive, best-kitted unit', () => {
    const facts = tftHeaderFactsFor(GAME, null)

    expect(facts.tft).toEqual({ placement: 3, team: false, trait: 'TFT18_FloraFatalis', unit: 'TFT18_Karma' })
    expect(facts.championId).toBeNull()
    expect(facts.kills).toBeNull()
  })

  it('times the game to the player’s elimination unless the recording says otherwise', () => {
    expect(tftHeaderFactsFor(GAME, null).durationSeconds).toBe(2_004)
    expect(tftHeaderFactsFor(GAME, 1_980.5).durationSeconds).toBe(1_980.5)
  })

  it('counts a Double Up game by the team’s place, and a top-two team as a good one', () => {
    const facts = tftHeaderFactsFor({ ...GAME, queueId: 1160, placement: 4, teamPlacement: 2 }, null)

    expect(facts.tft).toMatchObject({ placement: 2, team: true })
    expect(facts.win).toBe(true)
  })

  it('reads a bottom-half finish as a loss', () => {
    expect(tftHeaderFactsFor({ ...GAME, placement: 6 }, null).win).toBe(false)
  })

  it('tells a TFT row from a League one by its place', () => {
    expect(isTftRow(GAME)).toBe(true)
  })
})
