import { describe, expect, it } from 'vitest'
import { toLiveGameParticipants } from './liveGameMapping'
import { ActiveGameDtoSchema, type ActiveGameDto } from '../riot/types'
import type { Account } from '@shared/types'

const ACCOUNT: Account = {
  id: 1,
  puuid: 'puuid-me',
  gameName: 'Alluna',
  tagLine: 'NA1',
  platform: 'na1',
  regionalRoute: 'americas',
  summonerId: null,
  profileIconId: null,
  summonerLevel: null,
  isHomeAccount: true,
  createdAt: '',
  updatedAt: ''
}

/** A fully-populated participant, so each test can strip exactly the field it is about. */
function participant(over: Partial<ActiveGameDto['participants'][number]> = {}) {
  return {
    puuid: 'puuid-other',
    teamId: 100,
    championId: 412,
    spell1Id: 4,
    spell2Id: 14,
    riotId: 'StayyKawaii#NA1',
    ...over
  }
}

function game(participants: ActiveGameDto['participants']): ActiveGameDto {
  return { gameId: 1, gameMode: 'CLASSIC', gameLength: 600, participants }
}

/** Ten slots, blue first, so team-by-position has something realistic to work on. */
function fullRoster(over: Record<number, Partial<ActiveGameDto['participants'][number]>> = {}) {
  return game(
    Array.from({ length: 10 }, (_, i) =>
      participant({ puuid: `p${i}`, teamId: i < 5 ? 100 : 200, ...over[i] })
    )
  )
}

describe('toLiveGameParticipants', () => {
  it('keeps the name, tag and puuid of a player Riot identified', () => {
    const [p] = toLiveGameParticipants(game([participant()]), ACCOUNT)

    expect(p).toMatchObject({
      slot: 0,
      anonymous: false,
      puuid: 'puuid-other',
      gameName: 'StayyKawaii',
      tagLine: 'NA1',
      championId: 412
    })
  })

  it('marks a player with no riotId anonymous and withholds their puuid', () => {
    const [p] = toLiveGameParticipants(game([participant({ riotId: null })]), ACCOUNT)

    // The puuid is dropped rather than passed on: handing it to the renderer
    // would let it resolve the name and rank Riot deliberately withheld.
    expect(p).toMatchObject({
      anonymous: true,
      puuid: null,
      gameName: null,
      tagLine: null,
      championId: 412
    })
  })

  it('treats an empty riotId the same as a missing one', () => {
    const [p] = toLiveGameParticipants(game([participant({ riotId: '' })]), ACCOUNT)

    expect(p.anonymous).toBe(true)
  })

  it('names your own row from the account record even when Riot withheld it', () => {
    const [p] = toLiveGameParticipants(
      game([participant({ puuid: 'puuid-me', riotId: null })]),
      ACCOUNT
    )

    // The app already knows who you are; no Riot call, nothing unmasked.
    expect(p).toMatchObject({
      anonymous: false,
      puuid: 'puuid-me',
      gameName: 'Alluna',
      tagLine: 'NA1'
    })
  })

  it('infers a missing teamId from position in the list', () => {
    const roster = fullRoster({ 2: { teamId: null }, 7: { teamId: null } })
    const mapped = toLiveGameParticipants(roster, ACCOUNT)

    expect(mapped[2].teamId).toBe(100)
    expect(mapped[7].teamId).toBe(200)
    expect(mapped.filter((p) => p.teamId === 100)).toHaveLength(5)
    expect(mapped.filter((p) => p.teamId === 200)).toHaveLength(5)
  })

  it('keeps the slot of a participant with no champion', () => {
    const mapped = toLiveGameParticipants(
      fullRoster({ 9: { championId: null, spell1Id: null, spell2Id: null } }),
      ACCOUNT
    )

    expect(mapped).toHaveLength(10)
    expect(mapped[9]).toMatchObject({ slot: 9, teamId: 200, championId: null, spell1Id: null })
  })

  it('still returns ten rows when a participant is empty but for its type', () => {
    // The failure this replaces: one stripped participant threw on parse and
    // took the other nine down with it.
    const mapped = toLiveGameParticipants(fullRoster({ 4: { puuid: null, teamId: null, championId: null, spell1Id: null, spell2Id: null, riotId: null } }), ACCOUNT)

    expect(mapped).toHaveLength(10)
    expect(mapped[4]).toEqual({
      slot: 4,
      anonymous: true,
      puuid: null,
      gameName: null,
      tagLine: null,
      teamId: 100,
      championId: null,
      spell1Id: null,
      spell2Id: null
    })
  })
})

describe('ActiveGameDtoSchema', () => {
  it('parses a payload whose participant Riot stripped', () => {
    // The reported failure: zod arrays are all-or-nothing, so one withheld
    // field threw and the live game screen showed the error instead of the
    // other nine players.
    const payload = {
      gameId: 1,
      gameMode: 'CLASSIC',
      gameLength: 600,
      participants: [participant(), { teamId: 200, championId: 64 }]
    }

    const parsed = ActiveGameDtoSchema.parse(payload)

    expect(parsed.participants).toHaveLength(2)
    expect(toLiveGameParticipants(parsed, ACCOUNT)[1]).toMatchObject({
      anonymous: true,
      puuid: null,
      championId: 64
    })
  })

  it('accepts a null riotId, not just a missing one', () => {
    const payload = {
      gameId: 1,
      gameMode: 'CLASSIC',
      gameLength: 600,
      participants: [participant({ riotId: null, puuid: null })]
    }

    expect(() => ActiveGameDtoSchema.parse(payload)).not.toThrow()
  })
})
