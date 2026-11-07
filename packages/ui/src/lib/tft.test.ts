import { describe, expect, it } from 'vitest'
import type { AssetManifest } from '@foxfire/core'
import { costColor, formatStage, initials, placementTone, tftName, tftUnitCost, traitStyle } from './tft'

const MANIFEST = {
  version: '18.5.1',
  cdn: 'https://ddragon.example',
  championById: {},
  spellById: {},
  runeById: {},
  tft: {
    units: { tft18_jinx: { name: 'Jinx', image: null, cost: 4 } },
    traits: {},
    items: {},
    augments: {}
  }
} satisfies AssetManifest

describe('TFT names and costs', () => {
  it('reads the manifest without regard to case, and the id where it has nothing', () => {
    expect(tftName(MANIFEST, 'units', 'TFT18_Jinx')).toBe('Jinx')
    expect(tftName(MANIFEST, 'traits', 'TFT18_FloraFatalis')).toBe('Flora Fatalis')
    expect(tftName(null, 'items', 'TFT_Item_InfinityEdge')).toBe('Infinity Edge')
  })

  it("takes Data Dragon's cost, and Riot's rarity where it has none", () => {
    expect(tftUnitCost(MANIFEST, { characterId: 'TFT18_Jinx', tier: 2, rarity: 0, items: [] })).toBe(4)
    expect(tftUnitCost(MANIFEST, { characterId: 'TFT18_Karma', tier: 1, rarity: 6, items: [] })).toBe(5)
  })

  it('colours every cost, holding anything odd inside 1 to 5', () => {
    expect(costColor(0)).toBe(costColor(1))
    expect(costColor(9)).toBe(costColor(5))
  })
})

describe('a board at a glance', () => {
  it('styles a trait only when it is switched on', () => {
    expect(traitStyle(0)).toBeNull()
    expect(traitStyle(3)).not.toBeNull()
  })

  it('reads a win, the top half and the rest', () => {
    expect(placementTone(1, 4)).toBe('first')
    expect(placementTone(4, 4)).toBe('top')
    expect(placementTone(5, 4)).toBe('bottom')
    expect(placementTone(3, 2)).toBe('bottom')
  })

  it('names the stage a game ended on', () => {
    expect(formatStage(37, 1100)).toBe('Stage 6-5')
    expect(formatStage(20, 1130)).toBe('Round 20')
  })

  it('puts up to two letters on a unit with no portrait', () => {
    expect(initials('Jinx')).toBe('JI')
    expect(initials('Miss Fortune')).toBe('MF')
  })
})
