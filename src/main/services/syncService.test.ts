import { describe, expect, it } from 'vitest'
import { afterIdentityRepair, planMatchIdPages, selectNewMatchIds } from './syncPlanning'

// Riot returns match IDs newest-first.
const page = ['NA1_5', 'NA1_4', 'NA1_3', 'NA1_2', 'NA1_1']

describe('selectNewMatchIds', () => {
  it('returns everything when nothing has been synced yet', () => {
    expect(selectNewMatchIds(page, null)).toEqual(page)
  })

  it('returns only matches newer than the stored marker', () => {
    expect(selectNewMatchIds(page, 'NA1_3')).toEqual(['NA1_5', 'NA1_4'])
  })

  it('returns nothing when the newest stored match is still the newest overall', () => {
    expect(selectNewMatchIds(page, 'NA1_5')).toEqual([])
  })

  it('returns everything when the marker predates the whole page', () => {
    // Stored history is older than this page — every ID here is new to us.
    expect(selectNewMatchIds(page, 'NA1_0')).toEqual(page)
  })

  it('handles an empty page', () => {
    expect(selectNewMatchIds([], 'NA1_3')).toEqual([])
  })

  it('does not mutate the input list', () => {
    const original = [...page]
    selectNewMatchIds(page, 'NA1_3')
    expect(page).toEqual(original)
  })
})

describe('planMatchIdPages', () => {
  it('splits a 200-match backfill into two full pages', () => {
    expect(planMatchIdPages(200, 100)).toEqual([100, 100])
  })

  it('makes the final page a partial one when needed', () => {
    expect(planMatchIdPages(250, 100)).toEqual([100, 100, 50])
  })

  it('returns a single short page for small targets', () => {
    expect(planMatchIdPages(20, 100)).toEqual([20])
  })

  it('returns no pages for a zero target', () => {
    expect(planMatchIdPages(0, 100)).toEqual([])
  })
})

describe('afterIdentityRepair', () => {
  const RIOT_ID = 'Alluna#NA1'

  it('retries once the account has moved onto a new puuid', () => {
    expect(afterIdentityRepair('repaired', RIOT_ID)).toEqual({ retry: true })
  })

  it('does not retry a rename, and says whose', () => {
    const next = afterIdentityRepair('unresolved', RIOT_ID)

    expect(next.retry).toBe(false)
    expect(next.retry === false && next.message).toContain(RIOT_ID)
  })

  it('does not retry when Riot could not be asked', () => {
    expect(afterIdentityRepair('failed', RIOT_ID).retry).toBe(false)
  })

  // The request would fail identically the second time, so retrying it would
  // only spend a request to reach the same error.
  it('does not retry a puuid Riot rejects but reissues unchanged', () => {
    expect(afterIdentityRepair('unchanged', RIOT_ID).retry).toBe(false)
  })
})
