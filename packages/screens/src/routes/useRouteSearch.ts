import { useCallback } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'

export interface SearchUpdateOptions {
  /** Replace the current history entry rather than adding one. */
  replace?: boolean
}

/**
 * The search of the route this is rendered under, and a way to change it.
 *
 * Loose about which route that is, on purpose. The route table belongs to each
 * app, and these screens are compiled against every app's — so they read with
 * `strict: false` and rely on a component only ever being mounted under the
 * route whose validateSearch produced its search.
 *
 * A change merges into the current search. Setting a key to undefined removes
 * it, and says so: rememberSearch will not fill it back in.
 */
export function useRouteSearch<TSearch extends object>(): [
  TSearch,
  (changes: Partial<TSearch>, options?: SearchUpdateOptions) => void
] {
  // Read as unknown first: asserting straight to TSearch hands the router's
  // types a generic to infer their selection from, which they cannot resolve.
  const search: unknown = useSearch({ strict: false })
  const navigate = useNavigate()

  const update = useCallback(
    (changes: Partial<TSearch>, options: SearchUpdateOptions = {}) => {
      void navigate({
        to: '.',
        search: ((previous: TSearch) => ({ ...previous, ...changes })) as never,
        replace: options.replace,
        // A filter changing is not a new page; the list should stay where it is.
        resetScroll: false
      })
    },
    [navigate]
  )

  return [search as TSearch, update]
}
