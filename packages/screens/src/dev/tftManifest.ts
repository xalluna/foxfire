import type { TftAsset, TftAssets } from '@foxfire/core'

/*
 * The TFT half of the harness's asset manifest: names, costs and no art.
 *
 * Deliberately imageless. Data Dragon's TFT file names change with every set,
 * and a harness pointing at names that do not exist would draw broken images
 * — the thing a TFT row has to cope with anyway, for every game from a set the
 * manifest does not cover. So the harness shows the fallback every time, which
 * is the version of the row that most needs looking at.
 */

const named = (entries: Array<[id: string, name: string, cost?: number]>): Record<string, TftAsset> =>
  Object.fromEntries(
    entries.map(([id, name, cost]) => [id.toLowerCase(), { name, image: null, ...(cost ? { cost } : {}) }])
  )

export const TFT_MANIFEST: TftAssets = {
  units: named([
    ['TFT18_Poppy', 'Poppy', 1],
    ['TFT18_Zyra', 'Zyra', 1],
    ['TFT18_Elise', 'Elise', 2],
    ['TFT18_Vex', 'Vex', 2],
    ['TFT18_Lillia', 'Lillia', 3],
    ['TFT18_Ahri', 'Ahri', 3],
    ['TFT18_Morgana', 'Morgana', 4],
    ['TFT18_Jinx', 'Jinx', 4],
    ['TFT18_Karma', 'Karma', 5],
    ['TFT18_Xayah', 'Xayah', 5]
  ]),
  traits: named([
    ['TFT18_FloraFatalis', 'Flora Fatalis'],
    ['TFT18_Executioner', 'Executioner'],
    ['TFT18_Thornmaiden', 'Thornmaiden'],
    ['TFT18_Blackthorn', 'Blackthorn'],
    ['TFT18_Defender', 'Defender'],
    ['TFT18_Spellweaver', 'Spellweaver'],
    ['TFT18_Sprykin', 'Sprykin'],
    ['TFT18_Summoner', 'Summoner']
  ]),
  items: named([
    ['TFT_Item_InfinityEdge', 'Infinity Edge'],
    ['TFT_Item_JeweledGauntlet', 'Jeweled Gauntlet'],
    ['TFT_Item_Bloodthirster', 'Bloodthirster'],
    ['TFT_Item_WarmogsArmor', "Warmog's Armor"],
    ['TFT_Item_SpearOfShojin', 'Spear of Shojin'],
    ['TFT_Item_GuinsoosRageblade', "Guinsoo's Rageblade"],
    ['TFT_Item_ThiefsGloves', "Thief's Gloves"]
  ]),
  augments: named([
    ['TFT18_Augment_Pandora', "Pandora's Items"],
    ['TFT18_Augment_ItemGrabBag', 'Item Grab Bag'],
    ['TFT18_Augment_BuiltDifferent', 'Built Different'],
    ['TFT_Augment_HighRoller', 'High Roller']
  ])
}
