import { describe, expect, it } from 'vitest'
import { readingsFromRankedStats } from './rankedStats'
import { describeSession, sessionFacts } from './session'

/**
 * The client's ranked stats and gameflow session, as recorded from a client
 * playing both games. The shapes are Riot's; the values are a player's.
 */
const RANKED_STATS = {
  queues: [
    { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', leaguePoints: 41, wins: 30, losses: 28 },
    { queueType: 'RANKED_FLEX_SR', tier: 'NA', division: 'NA', leaguePoints: 0, wins: 0, losses: 0 },
    { queueType: 'RANKED_TFT', tier: 'MASTER', division: 'NA', leaguePoints: 212, wins: 40, losses: 0 },
    { queueType: 'RANKED_TFT_DOUBLE_UP', tier: 'PLATINUM', division: 'III', leaguePoints: 57, wins: 6, losses: 0 },
    { queueType: 'RANKED_TFT_TURBO', tier: 'NA', division: 'NA', leaguePoints: 0, wins: 3, losses: 0, ratedTier: 'BLUE', ratedRating: 2904 },
    { queueType: 'RANKED_TFT_PAIRS', tier: 'NA', division: 'NA', leaguePoints: 0 }
  ]
}

describe('readingsFromRankedStats', () => {
  it('keeps every ladder either game is ranked on, TFT’s included', () => {
    expect(readingsFromRankedStats(RANKED_STATS).map((r) => r.queueType)).toEqual([
      'RANKED_SOLO_5x5',
      'RANKED_TFT',
      'RANKED_TFT_DOUBLE_UP',
      'RANKED_TFT_TURBO'
    ])
  })

  it('reads an apex tier with no division as one', () => {
    expect(readingsFromRankedStats(RANKED_STATS)[1]).toMatchObject({ tier: 'MASTER', rank: null, leaguePoints: 212 })
  })

  it('reads Hyper Roll as a colour and a rating, with no rank or LP', () => {
    expect(readingsFromRankedStats(RANKED_STATS)[3]).toEqual({
      queueType: 'RANKED_TFT_TURBO',
      tier: null,
      rank: null,
      leaguePoints: null,
      wins: 3,
      losses: 0,
      ratedTier: 'BLUE',
      ratedRating: 2904
    })
  })

  it('leaves out a ladder nobody has played into', () => {
    expect(
      readingsFromRankedStats({ queues: [{ queueType: 'RANKED_TFT_TURBO', ratedTier: 'NONE', ratedRating: 0 }] })
    ).toEqual([])
    expect(readingsFromRankedStats(null)).toEqual([])
  })
})

describe('sessionFacts', () => {
  it('knows TFT by its mode, whatever the queue', () => {
    const session = {
      gameData: { gameId: 5_312_345_678, queue: { id: 6_000, gameMode: 'TFT', mapId: 22, type: 'RANKED_TFT_EVENT' } },
      map: { id: 22, gameMode: 'TFT' }
    }
    expect(sessionFacts(session)).toEqual({ game: 'tft', queueId: 6_000, gameId: 5_312_345_678 })
  })

  it('knows TFT by its map when the queue says nothing', () => {
    expect(sessionFacts({ gameData: { queue: { id: 1100 } }, map: { id: 22 } }).game).toBe('tft')
  })

  it('reads anything else as League, as every session was before TFT', () => {
    expect(sessionFacts({ gameData: { gameId: 1, queue: { id: 420, gameMode: 'CLASSIC', mapId: 11 } } })).toEqual({
      game: 'lol',
      queueId: 420,
      gameId: 1
    })
    expect(sessionFacts(undefined)).toEqual({ game: 'lol', queueId: null, gameId: null })
  })

  it('logs what it read, with the keys and the start of the raw session', () => {
    const described = describeSession({ gameData: { gameId: 9, queue: { id: 1100, gameMode: 'TFT' } } })
    expect(described).toMatchObject({ game: 'tft', gameMode: 'TFT', keys: ['gameData'], gameDataKeys: ['gameId', 'queue'] })
    expect(String(described.raw).length).toBeLessThanOrEqual(4_097)
  })
})
