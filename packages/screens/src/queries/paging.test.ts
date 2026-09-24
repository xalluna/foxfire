import { describe, expect, it } from 'vitest'
import type { InfiniteData } from '@tanstack/react-query'
import type { Page } from '@foxfire/core'
import { nextOffset, pageItems, pageTotal } from './paging'

const page = <T>(items: T[], total: number): Page<T> => ({ items, total })

const pages = <T>(...list: Page<T>[]): InfiniteData<Page<T>> => ({
  pages: list,
  pageParams: list.map((_, i) => i)
})

describe('nextOffset', () => {
  it('asks for the row after the last one fetched while there are more', () => {
    const first = page([1, 2], 5)
    const second = page([3, 4], 5)

    expect(nextOffset(first, [first])).toBe(2)
    expect(nextOffset(second, [first, second])).toBe(4)
  })

  it('stops once every row is in', () => {
    const first = page([1, 2], 3)
    const last = page([3], 3)

    expect(nextOffset(last, [first, last])).toBeUndefined()
    expect(nextOffset(page([], 0), [page([], 0)])).toBeUndefined()
  })

  it('stops on an empty page even when a stale total says there should be more', () => {
    const first = page([1, 2], 5)
    const empty = page<number>([], 5)

    expect(nextOffset(empty, [first, empty])).toBeUndefined()
  })

  it('stops when the list shrank under it', () => {
    const first = page([1, 2], 5)
    const shrunk = page([3], 3)

    expect(nextOffset(shrunk, [first, shrunk])).toBeUndefined()
  })
})

describe('pageItems', () => {
  it('lists every row fetched, in order', () => {
    expect(pageItems(pages(page([1, 2], 4), page([3, 4], 4)))).toEqual([1, 2, 3, 4])
    expect(pageItems<number>(undefined)).toEqual([])
  })

  it('draws a row once when a shifted offset hands it back on the next page', () => {
    const rows = pageItems(
      pages(page([{ id: 'a' }, { id: 'b' }], 5), page([{ id: 'b' }, { id: 'c' }], 5)),
      (row) => row.id
    )

    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('pageTotal', () => {
  it('reads the total off the page fetched most recently', () => {
    expect(pageTotal(pages(page([1], 9), page([2], 8)))).toBe(8)
    expect(pageTotal(undefined)).toBe(0)
  })
})
