import type { SearchMiddleware } from '@tanstack/react-router'

/**
 * A page's filters, carried across the session.
 *
 * The queue filter on the history and on the champion table used to live in a
 * UI store, held per page rather than once for the app so that browsing ARAM
 * history does not quietly rescope champion stats — and deliberately not
 * persisted, so every launch starts back on Ranked Solo/Duo. In a URL the filter
 * would be lost the moment somebody clicked a nav link that did not say it.
 *
 * So each page keeps a small memory of its own. `record` notes what the page is
 * showing whenever it is entered or its URL changes. `middleware` runs whenever
 * a link to the page is built, and fills in a remembered key the link left out.
 *
 * A link that sets a key to undefined has said something — "back to the default"
 * — and is not filled. Only a key the link never mentioned is. That is why the
 * validators keep absent keys absent rather than present-but-undefined.
 */
export interface SearchMemory<TSearch extends object> {
  record: (search: TSearch) => void
  middleware: SearchMiddleware<TSearch>
}

export function rememberSearch<TSearch extends object>(
  keys: ReadonlyArray<keyof TSearch>
): SearchMemory<TSearch> {
  let remembered: Partial<TSearch> = {}

  return {
    record: (search) => {
      const next: Partial<TSearch> = {}
      for (const key of keys) {
        if (search[key] !== undefined) next[key] = search[key]
      }
      remembered = next
    },

    middleware: ({ search, next }) => {
      const result = { ...next(search) }
      for (const key of keys) {
        if (!(key in result) && remembered[key] !== undefined) {
          result[key] = remembered[key] as TSearch[keyof TSearch]
        }
      }
      return result
    }
  }
}
