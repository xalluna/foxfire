import { describe, expect, it } from 'vitest'
import { toScoreboard } from './scoreboardMapping'
import { AllGameDataSchema, type AllGameDataDto, type LivePlayerDto } from './types'
import type { AssetManifest } from '@shared/types'

const ACCOUNT = 'Faker#NA1'

/** Enough of a manifest to exercise both lookups, including two champions whose key and display name disagree. */
const MANIFEST: AssetManifest = {
  version: '16.16.1',
  cdn: 'https://ddragon.leagueoflegends.com/cdn',
  championById: {
    20: { id: 'Nunu', name: 'Nunu & Willump' },
    62: { id: 'MonkeyKing', name: 'Wukong' },
    103: { id: 'Ahri', name: 'Ahri' },
    412: { id: 'Thresh', name: 'Thresh' }
  },
  spellById: {},
  runeById: {}
}

/** A fully-populated player, so each test can strip exactly the field it is about. */
function player(over: Partial<LivePlayerDto> = {}): LivePlayerDto {
  return {
    riotIdGameName: 'StayyKawaii',
    riotIdTagLine: 'NA1',
    championName: 'Ahri',
    rawChampionName: 'game_character_displayname_Ahri',
    ...over
  }
}

function game(allPlayers: LivePlayerDto[], over: Partial<AllGameDataDto> = {}): AllGameDataDto {
  return {
    activePlayer: { riotId: 'Faker#NA1' },
    allPlayers,
    gameData: { gameTime: 847.5 },
    ...over
  }
}

/** Ten players, named p0 to p9. */
function fullRoster(over: Record<number, Partial<LivePlayerDto>> = {}): AllGameDataDto {
  return game(Array.from({ length: 10 }, (_, i) => player({ riotIdGameName: `p${i}`, ...over[i] })))
}

describe('toScoreboard', () => {
  it('keeps every player, in the order the game sent them', () => {
    const { players } = toScoreboard(fullRoster(), MANIFEST, ACCOUNT)

    expect(players.map((p) => p.gameName)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${i}`)
    )
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

    expect(players[0].championId).toBeNull()
  })

  it('treats a blank Riot ID as no Riot ID', () => {
    // A real ARAM returned one player named '' and tagged ''.
    const { players } = toScoreboard(
      game([player({ riotIdGameName: '', riotIdTagLine: '' })]),
      MANIFEST,
      ACCOUNT
    )

    expect(players[0]).toMatchObject({ gameName: null, tagLine: null })
  })

  it('does not mistake two blank players for each other when marking self', () => {
    const roster = game([
      player({ riotIdGameName: '', riotIdTagLine: '' }),
      player({ riotIdGameName: '', riotIdTagLine: '' })
    ])
    roster.activePlayer = { riotId: 'Faker#NA1' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players.filter((p) => p.isSelf)).toHaveLength(0)
  })

  it('marks the tracked account rather than whoever is at the keyboard', () => {
    const roster = fullRoster({
      3: { riotIdGameName: 'Faker', riotIdTagLine: 'NA1' },
      7: { riotIdGameName: 'SomebodyElse', riotIdTagLine: 'NA1' }
    })
    roster.activePlayer = { riotId: 'SomebodyElse#NA1' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players.filter((p) => p.isSelf).map((p) => p.gameName)).toEqual(['Faker'])
  })

  it('falls back to the active player when the tracked account is not in the game', () => {
    const roster = fullRoster({ 7: { riotIdGameName: 'SomebodyElse', riotIdTagLine: 'NA1' } })
    roster.activePlayer = { riotId: 'SomebodyElse#NA1' }

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players.filter((p) => p.isSelf).map((p) => p.gameName)).toEqual(['SomebodyElse'])
  })

  it('holds the place of a player the payload says almost nothing about', () => {
    const roster = fullRoster()
    roster.allPlayers![4] = {}

    const { players } = toScoreboard(roster, MANIFEST, ACCOUNT)

    expect(players).toHaveLength(10)
    expect(players[4]).toEqual({ gameName: null, tagLine: null, isSelf: false, championId: null })
  })

  it('carries the game clock through', () => {
    const board = toScoreboard(fullRoster(), MANIFEST, ACCOUNT)

    expect(board.gameTime).toBe(847.5)
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
      allPlayers: [{ championName: 'Ahri', somethingNew: { nested: true } }],
      gameData: { gameTime: 12 },
      newTopLevelThing: 1
    })

    expect(parsed.allPlayers?.[0].championName).toBe('Ahri')
  })
})
