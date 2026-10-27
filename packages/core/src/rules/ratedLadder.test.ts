import { describe, expect, it } from 'vitest'
import {
  ladderMovementFor,
  ladderPositionFor,
  ratedBandBoundaries,
  ratedMovement,
  ratedTierAt
} from './ratedLadder'

describe('the rated ladder', () => {
  it('names the tier a rating falls in', () => {
    expect(ratedTierAt(0)).toBe('GRAY')
    expect(ratedTierAt(1399)).toBe('GRAY')
    expect(ratedTierAt(1400)).toBe('GREEN')
    expect(ratedTierAt(3612)).toBe('PURPLE')
    expect(ratedTierAt(9000)).toBe('ORANGE')
  })

  it('bands from the bottom up', () => {
    const bands = ratedBandBoundaries()
    expect(bands.map((b) => b.tier)).toEqual(['GRAY', 'GREEN', 'BLUE', 'PURPLE', 'ORANGE'])
    expect(bands.every((b, i) => i === 0 || b.start > bands[i - 1]!.start)).toBe(true)
  })

  it('moves only when the colour changes', () => {
    expect(ratedMovement('BLUE', 'PURPLE')).toBe('promotion')
    expect(ratedMovement('PURPLE', 'BLUE')).toBe('demotion')
    expect(ratedMovement('BLUE', 'BLUE')).toBe('none')
    expect(ratedMovement(null, 'BLUE')).toBe('none')
  })
})

describe('positions on either kind of ladder', () => {
  it('is the rating on Hyper Roll, and the folded rank everywhere else', () => {
    expect(ladderPositionFor('RANKED_TFT_TURBO', { tier: null, rank: null, leaguePoints: null, ratedRating: 3612 })).toBe(
      3612
    )
    expect(ladderPositionFor('RANKED_TFT_TURBO', { tier: null, rank: null, leaguePoints: null })).toBeNull()
    expect(ladderPositionFor('RANKED_TFT', { tier: 'IRON', rank: 'IV', leaguePoints: 50 })).toBe(50)
  })

  it('moves by colour on Hyper Roll, and by tier and division elsewhere', () => {
    expect(
      ladderMovementFor(
        'RANKED_TFT_TURBO',
        { tier: null, rank: null, leaguePoints: null, ratedTier: 'BLUE' },
        { tier: null, rank: null, leaguePoints: null, ratedTier: 'PURPLE' }
      )
    ).toBe('promotion')
    expect(
      ladderMovementFor(
        'RANKED_TFT_DOUBLE_UP',
        { tier: 'GOLD', rank: 'I', leaguePoints: 90 },
        { tier: 'PLATINUM', rank: 'IV', leaguePoints: 10 }
      )
    ).toBe('promotion')
  })
})
