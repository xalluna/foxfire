import type { InfiniteData } from '@tanstack/react-query'
import type { Page } from '@foxfire/core'

/**
 * Where the next page starts, or undefined when there is none — the
 * `getNextPageParam` of every paged list the screens show.
 *
 * Counted from the rows fetched rather than from how many pages there are, so
 * a list whose pages differ in size still asks for the right place. The total
 * says when to stop. A page that came back empty stops it too, whatever the
 * total claims: somebody may have been deleted between two pages, and a total
 * read before that would otherwise ask for the same nothing forever.
 */
export function nextOffset(last: Page<unknown>, all: Page<unknown>[]): number | undefined {
  const loaded = all.reduce((count, page) => count + page.items.length, 0)
  return last.items.length > 0 && loaded < last.total ? loaded : undefined
}

/**
 * Every row fetched so far, in order.
 *
 * With a key, a row that turns up on two pages is shown once. Offsets move when
 * a row lands at the head of a list between one page and the next — a game
 * syncs, somebody registers — and the last row of one page arrives again as the
 * first of the next. Refetching puts it right; until then it should not be
 * drawn twice, and React would complain about the key.
 */
export function pageItems<T>(
  data: InfiniteData<Page<T>> | undefined,
  keyOf?: (item: T) => string | number
): T[] {
  const rows = data?.pages.flatMap((page) => page.items) ?? []
  if (!keyOf) return rows

  const seen = new Set<string | number>()
  return rows.filter((row) => {
    const key = keyOf(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** How long the whole list is, as of the page fetched most recently. Zero before any has been. */
export function pageTotal(data: InfiniteData<Page<unknown>> | undefined): number {
  return data?.pages.at(-1)?.total ?? 0
}
