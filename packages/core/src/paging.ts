import type { Page, PageOptions } from './types'

/**
 * The page sizes every Foxfire list agrees on.
 *
 * The server clamps what it is asked for to these, and so does everything that
 * answers the same questions without one — the desktop's own database, and the
 * fixture client the harnesses run on — so a screen sees the same pages
 * whichever it is talking to.
 */
export const PAGE_LIMIT_DEFAULT = 50
export const PAGE_LIMIT_MAX = 100

/** Match history's page, which is smaller: each row is dense, and twenty fills a window. */
export const MATCH_PAGE_LIMIT_DEFAULT = 20

/** What was asked for, once the caps have had their say. */
export function clampPage(
  options: PageOptions | undefined,
  defaultLimit: number = PAGE_LIMIT_DEFAULT
): { limit: number; offset: number } {
  const limit = Math.trunc(options?.limit ?? defaultLimit)
  const offset = Math.trunc(options?.offset ?? 0)

  return {
    limit: Math.min(Math.max(Number.isFinite(limit) ? limit : defaultLimit, 1), PAGE_LIMIT_MAX),
    offset: Math.max(Number.isFinite(offset) ? offset : 0, 0)
  }
}

/**
 * One page of a list already held whole — for the places that answer a paged
 * question out of memory: a local database read that is small enough to
 * filter in JavaScript, and the fixtures.
 */
export function pageOf<T>(all: readonly T[], options?: PageOptions, defaultLimit?: number): Page<T> {
  const { limit, offset } = clampPage(options, defaultLimit)
  return { items: all.slice(offset, offset + limit), total: all.length }
}
