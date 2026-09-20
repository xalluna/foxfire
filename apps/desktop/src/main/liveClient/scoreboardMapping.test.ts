import { describe, expect, it } from 'vitest'
import { toScoreboard } from './scoreboardMapping'
import { AllGameDataSchema, type AllGameDataDto, type LivePlayerDto } from './types'
import type { AssetManifest } from '@shared/types'

const ACCOUNT = 'Faker#NA1'

/**
 * Enough of a manifest to exercise every lookup, including the two champions
 * whose key and display name disagree and the spell name that is not unique.
 */
const MANIFEST: AssetManifest = {
  version: '16.16.1',
  cdn: 'https://ddragon.leagueoflegends.com/cdn',
  championById: {
    20: { id: 'Nunu', name: 'Nunu & Willump' },
    62: { id: 'MonkeyKing', name: 'Wukong' },
    103: { id: 'Ahri', name: 'Ahri' },
    412: { id: 'Thresh', name: 'Thresh' }
  },
  spellById: {
    4: { id: 'SummonerFlash', name: 'Flash' },
    11: { id: 'SummonerSmite', name: 'Smite' },
    14: { id: 'SummonerDot', name: 'Ignite' },
    32: { id: 'SummonerSnowball', name: 'Mark' },
    39: { id: 'SummonerSnowURFSnowball_Mark', name: 'Mark' }
  },
  runeById: {}
}

/** A fully-populated player, so each test can strip exactly the field it is about. */
function player(over: Partial<LivePlayerDto> = {}): LivePlayerDto {
  return {
    riotId: 'StayyKawaii#NA1',
    riotIdGameName: 'StayyKawaii',
    riotIdTagLine: 'NA1',
    championName: 'Ahri',
    rawChampionName: 'game_character_displayname_Ahri',
    position: 'MIDDLE',
    level: 6,
    isBot: false,
    isDead: false,
    respawnTimer: 0,
    team: 'ORDER',
    items: [{ itemID: 3020, slot: 0, count: 1 }],
    scores: { kills: 2, deaths: 1, assists: 3, creepScore: 84, wardScore: 7.5 },
    summonerSpells: {
      summonerSpellOne: { displayName: 'Flash', rawDisplayName: '' },
      summonerSpellTwo: { displayName: 'Ignite', rawDisplayName: '' }
    },
    runes: {
      keystone: { id: 8112, displayName: 'Electrocute' },
      primaryRuneTree: { id: 8100, displayName: 'Domination' },
      secondaryRuneTree: { id: 8200, displayName: 'Sorcery' }
    },
    ...over
  }
}

function game(allPlayers: LivePlayerDto[], over: Partial<AllGameDataDto> = {}): AllGameDataDto {
  return {
    activePlayer: { riotId: 'Faker#NA1', summonerName: 'Faker' },
    allPlayers,
    gameData: { gameMode: 'CLASSIC', gameTime: 847.5, mapName: 'Map11' },
    ...over
  }
}

/** Ten players in deliberately scrambled lane order, five a side. */
function fullRoster(over: Record<number, Partial<LivePlayerDto>> = {}): AllGameDataDto {
  const positions = ['UTILITY', 'MIDDLE', 'TOP', 'BOTTOM', 'JUNGLE']
  return game(
    Array.from({ length: 10 }, (_, i) =>
      player({
        riotIdGameName: `p${i}`,
        team: i < 5 ? 'ORDER' : 'CHAOS',
        position: positions[i % 5],
        ...over[i]
      })
    )
  )
}

describe('toScoreboard', () => {
  it('orders each side top, jungle, mid, bot, support whatever order it arrives in', () => {
    const { players } = toScoreboard(fullRoster(), MANIFEST, ACCOUNT)

    expect(players.map((p) => p.position)).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY',
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY'
    ])
    expect(players.map((p) => p.teamId)).toEqual([100, 100, 100, 100, 100, 200, 200, 200, 200, 200])
  })

  it('keeps the slot each player arrived in, so reordering does not lose the key', () => {
    const { players } = toScoreboard(fullRoster(), MANIFEST, ACCOUNT)

    // Blue arrived UTILITY, MIDDLE, TOP, BOTTOM, JUNGLE at slots 0-4.
    expect(players.slice(0, 5).map((p) => p.slot)).toEqual([2, 4, 1, 3, 0])
    expect(new Set(players.map((p) => p.slot)).size).toBe(10)
  })

  // "NONE" is what a real ARAM sends — not the empty string match-v5 uses, which
  // is what this test asserted until a live payload said otherwise.
  it.each(['NONE', '', null])('leaves a mode without lanes (%s) in the order the game sent it', (position) => {
    const aram = game(
      Array.from({ length: 10 }, (_, i) =>
        player({ riotIdGameName: `p${i}`, team: i < 5 ? 'ORDER' : 'CHAOS', position })
      )
    )

    const { players } = toScoreboard(aram, MANIFEST, ACCOUNT)

    expect(players.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(players.every((p) => p.position === null)).toBe(true)
  })

  it('resolves the champion from the raw name, which is the same in every language', () => {
    const { players } = toScoreboard(
      game([
        player({ rawChampionName: 'game_character_displayname_MonkeyKing', championName: 'Wukong' }),
        player({
          rawChampionName: 'game_character_displayname_Nunu',
          championName: 'Nunu & Willump'
        })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players.map((p) => p.championId)).toEqual([62, 20])
  })

  it('falls back to the display name when the raw name is missing', () => {
    const { players } = toScoreboard(
      game([player({ rawChampionName: null, championName: 'Wukong' })]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0].championId).toBe(62)
  })

  it('leaves the champion null when the manifest has never heard of it', () => {
    const { players } = toScoreboard(
      game([
        player({ rawChampionName: 'game_character_displayname_Whoever', championName: 'Whoever' })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0]).toMatchObject({ championId: null, championName: 'Whoever' })
  })

  it('numbers summoner spells from their display names', () => {
    const { players } = toScoreboard(
      game([
        player({
          summonerSpells: {
            summonerSpellOne: { displayName: 'Smite', rawDisplayName: '' },
            summonerSpellTwo: { displayName: 'Flash', rawDisplayName: '' }
          }
        })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0]).toMatchObject({ spell1Id: 11, spell2Id: 4 })
  })

  it('picks the lower id when two spells share a display name', () => {
    const { players } = toScoreboard(
      game([
        player({
          summonerSpells: {
            summonerSpellOne: { displayName: 'Mark', rawDisplayName: '' },
            summonerSpellTwo: { displayName: 'Flash', rawDisplayName: '' }
          }
        })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0].spell1Id).toBe(32)
  })

  it('rebuilds a build with a hole in it into seven slots, trinket last', () => {
    const { players } = toScoreboard(
      game([
        player({
          items: [
            { itemID: 3020, slot: 0, count: 1 },
            { itemID: 3089, slot: 3, count: 1 },
            { itemID: 3340, slot: 6, count: 1 }
          ]
        })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0].items).toEqual([3020, 0, 0, 3089, 0, 0, 3340])
    expect(players[0].roleBoundItem).toBe(0)
  })

  it('takes anything past the inventory as the lane reward rather than an item', () => {
    const { players } = toScoreboard(
      game([
        player({
          items: [
            { itemID: 3340, slot: 6, count: 1 },
            { itemID: 1206, slot: 7, count: 1 }
          ]
        })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0].items).toEqual([0, 0, 0, 0, 0, 0, 3340])
    expect(players[0].roleBoundItem).toBe(1206)
  })

  it('carries the respawn countdown of a dead player, and none for a living one', () => {
    const { players } = toScoreboard(
      game([
        player({ isDead: true, respawnTimer: 12.5 }),
        // The game leaves a stale timer on a player who has already respawned.
        player({ isDead: false, respawnTimer: 12.5 })
      ]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0]).toMatchObject({ isDead: true, respawnTimer: 12.5 })
    expect(players[1]).toMatchObject({ isDead: false, respawnTimer: 0 })
  })

  it('treats a blank Riot ID as no Riot ID', () => {
    // A real ARAM returned one player named '' and tagged '', which rendered a
    // nameless row and sent an empty Riot ID off to be looked up.
    const { players } = toScoreboard(
      game([player({ riotIdGameName: '', riotIdTagLine: '', championName: '' })]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0]).toMatchObject({ gameName: null, tagLine: null, championName: null })
  })

  it('does not mistake two blank players for each other when marking self', () => {
    const roster = game([
      player({ riotIdGameName: '', riotIdTagLine: '' }),
      player({ riotIdGameName: '', riotIdTagLine: '' })
    ])
    roster.activePlayer = { riotId: 'Faker#NA1', summonerName: 'Faker' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players.filter((p) => p.isSelf)).toHaveLength(0)
  })

  it('marks the tracked account rather than whoever is at the keyboard', () => {
    const roster = fullRoster({
      3: { riotIdGameName: 'Faker', riotIdTagLine: 'NA1' },
      7: { riotIdGameName: 'SomebodyElse', riotIdTagLine: 'NA1' }
    })
    roster.activePlayer = { riotId: 'SomebodyElse#NA1', summonerName: 'SomebodyElse' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players.filter((p) => p.isSelf).map((p) => p.gameName)).toEqual(['Faker'])
  })

  it('falls back to the active player when the tracked account is not in the game', () => {
    const roster = fullRoster({ 7: { riotIdGameName: 'SomebodyElse', riotIdTagLine: 'NA1' } })
    roster.activePlayer = { riotId: 'SomebodyElse#NA1', summonerName: 'SomebodyElse' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players.filter((p) => p.isSelf).map((p) => p.gameName)).toEqual(['SomebodyElse'])
  })

  it('holds the slot of a player the payload says almost nothing about', () => {
    const roster = fullRoster()
    roster.allPlayers![4] = { team: 'ORDER' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players).toHaveLength(10)
    // No position, so the stripped row sorts to the end of its own side.
    expect(players[4]).toMatchObject({
      gameName: null,
      championId: null,
      position: null,
      teamId: 100,
      kills: 0,
      deaths: 0,
      assists: 0,
      items: [0, 0, 0, 0, 0, 0, 0]
    })
  })

  it('carries the game clock and mode through', () => {
    const board = toScoreboard(fullRoster(), MANIFEST, ACCOUNT)

    expect(board).toMatchObject({ gameMode: 'CLASSIC', gameTime: 847.5, mapName: 'Map11' })
  })
})

describe('AllGameDataSchema', () => {
  it('parses a payload whose players are missing most of their fields', () => {
    const parsed = AllGameDataSchema.parse({
      allPlayers: [{ team: 'ORDER' }, { team: 'CHAOS', championName: 'Ahri' }],
      gameData: { gameMode: 'CLASSIC' }
    })

    expect(parsed.allPlayers).toHaveLength(2)
  })

  it('keeps parsing when the game adds a field nobody has seen before', () => {
    const parsed = AllGameDataSchema.parse({
      allPlayers: [{ team: 'ORDER', somethingNew: { nested: true } }],
      gameData: { gameMode: 'CLASSIC' },
      newTopLevelThing: 1
    })

    expect(parsed.allPlayers?.[0].team).toBe('ORDER')
  })
})
