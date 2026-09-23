import { describe, expect, it } from 'vitest'
import {
  absoluteUrl,
  parseQueueParam,
  parseRangeParam,
  parseRankQueueParam,
  paths,
  queueParam,
  rankQueueParam
} from './paths'
import { isPlayer, parsePlayerSlug, playerSlug } from './slug'

const FAKER = { gameName: 'Faker', tagLine: 'KR1' }

describe('player slugs', () => {
  it('round-trips a Riot ID', () => {
    expect(playerSlug(FAKER)).toBe('Faker-KR1')
    expect(parsePlayerSlug('Faker-KR1')).toEqual(FAKER)
  })

  it('splits on the last hyphen, because a game name may contain one and a tag line may not', () => {
    expect(parsePlayerSlug('the-real-deal-EUW')).toEqual({ gameName: 'the-real-deal', tagLine: 'EUW' })
  })

  it('keeps spaces and letters from other alphabets in the name', () => {
    const riotId = { gameName: 'Hide on bush', tagLine: 'KR1' }
    expect(parsePlayerSlug(playerSlug(riotId))).toEqual(riotId)
    expect(parsePlayerSlug('페이커-KR1')).toEqual({ gameName: '페이커', tagLine: 'KR1' })
  })

  it('refuses what cannot be a Riot ID', () => {
    expect(parsePlayerSlug('Faker')).toBeNull()
    expect(parsePlayerSlug('-KR1')).toBeNull()
    expect(parsePlayerSlug('Faker-')).toBeNull()
    expect(parsePlayerSlug('')).toBeNull()
  })

  it('matches an account without regard to case, as Riot does', () => {
    expect(isPlayer(FAKER, { gameName: 'faker', tagLine: 'kr1' })).toBe(true)
    expect(isPlayer(FAKER, { gameName: 'Faker', tagLine: 'NA1' })).toBe(false)
  })
})

describe('queue params', () => {
  it('says "all" for no filter, so a link that means every queue says so', () => {
    expect(queueParam(null)).toBe('all')
    expect(queueParam(420)).toBe('420')
    expect(parseQueueParam('all')).toBeNull()
    expect(parseQueueParam('440')).toBe(440)
  })

  it('treats anything unreadable as absent rather than as a queue', () => {
    expect(parseQueueParam('ranked')).toBeUndefined()
    expect(parseQueueParam('-1')).toBeUndefined()
    expect(parseQueueParam(undefined)).toBeUndefined()
  })
})

describe('ladder params', () => {
  it('names the two ladders the way a person would', () => {
    expect(rankQueueParam('RANKED_SOLO_5x5')).toBe('solo')
    expect(rankQueueParam('RANKED_FLEX_SR')).toBe('flex')
    expect(parseRankQueueParam('solo')).toBe('RANKED_SOLO_5x5')
    expect(parseRankQueueParam('flex')).toBe('RANKED_FLEX_SR')
  })

  it('treats anything else as absent', () => {
    expect(parseRankQueueParam('RANKED_SOLO_5x5')).toBeUndefined()
    expect(parseRankQueueParam(420)).toBeUndefined()
    expect(parseRankQueueParam(undefined)).toBeUndefined()
  })
})

describe('range params', () => {
  it('accepts every period a screen can offer', () => {
    expect(parseRangeParam('7d')).toBe('7d')
    expect(parseRangeParam('30d')).toBe('30d')
    expect(parseRangeParam('all')).toBe('all')
    expect(parseRangeParam('season:12')).toBe('season:12')
  })

  it('treats anything else as absent', () => {
    expect(parseRangeParam('season:')).toBeUndefined()
    expect(parseRangeParam('season:twelve')).toBeUndefined()
    expect(parseRangeParam('90d')).toBeUndefined()
    expect(parseRangeParam(30)).toBeUndefined()
  })
})

describe('paths', () => {
  it('encodes a player into one path segment', () => {
    expect(paths.player({ gameName: 'Hide on bush', tagLine: 'KR1' })).toBe('/players/Hide%20on%20bush-KR1')
  })

  it('carries the view in the query, so a shared link opens on what was shared', () => {
    expect(paths.player(FAKER, { queue: null })).toBe('/players/Faker-KR1?queue=all')
    expect(paths.rank(FAKER, { queue: 'flex', range: 'season:12' })).toBe(
      '/players/Faker-KR1/rank?queue=flex&range=season%3A12'
    )
    expect(paths.lpEditor(FAKER, { queue: 'solo', match: 'KR_1' })).toBe(
      '/players/Faker-KR1/lp?queue=solo&match=KR_1'
    )
    expect(paths.player(FAKER, { match: 'KR_1' })).toBe('/players/Faker-KR1?match=KR_1')
  })

  it('leaves the query off when there is nothing to say', () => {
    expect(paths.player(FAKER)).toBe('/players/Faker-KR1')
    expect(paths.champions(FAKER)).toBe('/players/Faker-KR1/champions')
    expect(paths.players()).toBe('/players')
    expect(paths.players('')).toBe('/players')
  })

  it('names a match, and optionally whose view of it', () => {
    expect(paths.match('KR_7123')).toBe('/matches/KR_7123')
    expect(paths.match('KR_7123', { player: FAKER })).toBe('/matches/KR_7123?player=Faker-KR1')
  })

  it('carries a finder query', () => {
    expect(paths.players('Faker#KR1')).toBe('/players?q=Faker%23KR1')
  })
})

describe('absoluteUrl', () => {
  it('joins a public address and a path with exactly one slash', () => {
    expect(absoluteUrl('https://fox.example', '/players/Faker-KR1')).toBe('https://fox.example/players/Faker-KR1')
    expect(absoluteUrl('https://fox.example/', '/players/Faker-KR1')).toBe('https://fox.example/players/Faker-KR1')
    expect(absoluteUrl('https://fox.example', 'players')).toBe('https://fox.example/players')
  })
})
