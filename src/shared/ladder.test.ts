import { describe, expect, it } from 'vitest'
import { APEX_BASE, ladderPosition, rankMovement, tierAtPosition } from './ladder'

function at(tier: string | null, rank: string | null, leaguePoints: number | null) {
  return { tier, rank, leaguePoints }
}

describe('ladderPosition', () => {
  it('starts the ladder at Iron IV 0 LP', () => {
    expect(ladderPosition(at('IRON', 'IV', 0))).toBe(0)
  })

  it('orders divisions within a tier', () => {
    expect(ladderPosition(at('GOLD', 'IV', 0))).toBe(1200)
    expect(ladderPosition(at('GOLD', 'III', 0))).toBe(1300)
    expect(ladderPosition(at('GOLD', 'II', 50))).toBe(1450)
    expect(ladderPosition(at('GOLD', 'I', 99))).toBe(1599)
  })

  it('meets the apex scale exactly at Diamond I 100 LP', () => {
    expect(ladderPosition(at('DIAMOND', 'I', 100))).toBe(APEX_BASE)
    expect(ladderPosition(at('MASTER', 'I', 0))).toBe(APEX_BASE)
  })

  it('treats the apex tiers as one shared scale', () => {
    // Master/Grandmaster/Challenger are decided by ladder cutoffs, not LP, so
    // the same LP is the same position regardless of which name it carries.
    expect(ladderPosition(at('MASTER', 'I', 500))).toBe(3300)
    expect(ladderPosition(at('GRANDMASTER', 'I', 500))).toBe(3300)
    expect(ladderPosition(at('CHALLENGER', 'I', 500))).toBe(3300)
  })

  it('returns null when unranked or the rank is unusable', () => {
    expect(ladderPosition(at(null, null, null))).toBeNull()
    expect(ladderPosition(at('GOLD', null, 50))).toBeNull()
    expect(ladderPosition(at('NOT_A_TIER', 'I', 50))).toBeNull()
  })

  it('treats missing LP as zero rather than unranked', () => {
    expect(ladderPosition(at('SILVER', 'II', null))).toBe(1000)
  })
})

describe('rankMovement', () => {
  it('ignores LP changes inside a division', () => {
    expect(rankMovement(at('GOLD', 'II', 20), at('GOLD', 'II', 43))).toBe('none')
    expect(rankMovement(at('GOLD', 'II', 43), at('GOLD', 'II', 26))).toBe('none')
  })

  it('detects division promotions and demotions', () => {
    expect(rankMovement(at('GOLD', 'II', 98), at('GOLD', 'I', 12))).toBe('promotion')
    expect(rankMovement(at('GOLD', 'II', 3), at('GOLD', 'III', 75))).toBe('demotion')
  })

  it('detects tier promotions and demotions', () => {
    expect(rankMovement(at('GOLD', 'I', 98), at('PLATINUM', 'IV', 12))).toBe('promotion')
    expect(rankMovement(at('PLATINUM', 'IV', 0), at('GOLD', 'I', 75))).toBe('demotion')
  })

  it('treats Master to Grandmaster as a promotion despite the shared position', () => {
    expect(rankMovement(at('MASTER', 'I', 500), at('GRANDMASTER', 'I', 500))).toBe('promotion')
    expect(rankMovement(at('CHALLENGER', 'I', 900), at('GRANDMASTER', 'I', 880))).toBe('demotion')
  })

  it('reports none when either side is unranked', () => {
    expect(rankMovement(at(null, null, null), at('IRON', 'IV', 0))).toBe('none')
    expect(rankMovement(at('IRON', 'IV', 0), at(null, null, null))).toBe('none')
  })
})

describe('tierAtPosition', () => {
  it('maps a position back to its tier', () => {
    expect(tierAtPosition(0)).toBe('IRON')
    expect(tierAtPosition(1250)).toBe('GOLD')
    expect(tierAtPosition(APEX_BASE)).toBe('MASTER')
    expect(tierAtPosition(APEX_BASE + 1200)).toBe('MASTER')
  })
})
