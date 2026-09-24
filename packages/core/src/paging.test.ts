import { describe, expect, it } from 'vitest'
import { clampPage, MATCH_PAGE_LIMIT_DEFAULT, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, pageOf } from './paging'

describe('clampPage', () => {
  it('answers with the first page when asked for nothing', () => {
    expect(clampPage(undefined)).toEqual({ limit: PAGE_LIMIT_DEFAULT, offset: 0 })
    expect(clampPage({}, MATCH_PAGE_LIMIT_DEFAULT)).toEqual({ limit: MATCH_PAGE_LIMIT_DEFAULT, offset: 0 })
  })

  it('caps a page however much is asked for, and never answers with less than one', () => {
    expect(clampPage({ limit: 100_000 }).limit).toBe(PAGE_LIMIT_MAX)
    expect(clampPage({ limit: 0 }).limit).toBe(1)
    expect(clampPage({ limit: -5 }).limit).toBe(1)
  })

  it('reads a negative or nonsense offset as the start', () => {
    expect(clampPage({ offset: -10 }).offset).toBe(0)
    expect(clampPage({ offset: Number.NaN, limit: Number.NaN })).toEqual({ limit: PAGE_LIMIT_DEFAULT, offset: 0 })
  })
})

describe('pageOf', () => {
  const all = Array.from({ length: 7 }, (_, i) => i)

  it('slices a page and counts the whole', () => {
    expect(pageOf(all, { limit: 3 })).toEqual({ items: [0, 1, 2], total: 7 })
    expect(pageOf(all, { limit: 3, offset: 6 })).toEqual({ items: [6], total: 7 })
  })

  it('answers past the end with nothing, and still says how many there are', () => {
    expect(pageOf(all, { limit: 3, offset: 9 })).toEqual({ items: [], total: 7 })
  })
})
