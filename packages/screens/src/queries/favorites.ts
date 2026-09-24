import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FAVORITES_LIMIT, refreshFavorites, type FavoritePlayer, type PlayerSearchResult } from '@foxfire/core'
import { useClient } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from './keys'

/** Said when a star does not take, because ten are already starred. */
export const FAVORITES_FULL = `You already have ${FAVORITES_LIMIT} favorites. Unstar one to add another.`

export interface Favorites {
  /**
   * Whether starring anybody is offered here. Only with a server: local-only
   * has no community to keep an eye on, and every account it has is on the
   * rail already.
   */
  available: boolean
  favorites: FavoritePlayer[]
  isFavorite: (accountId: string) => boolean
}

/**
 * The players this machine or browser starred, newest first.
 *
 * Never stale by the clock: nothing but this device changes the list, and it
 * writes the answer of every change straight into the cache. What does move is
 * the server the desktop is connected to, which `connectionChanged` covers.
 */
export function useFavorites(): Favorites {
  const client = useClient()
  const available = useConnection()?.mode === 'server'

  const { data } = useQuery({
    queryKey: queryKeys.favorites(),
    queryFn: () => client.favorites.list(),
    staleTime: Infinity,
    enabled: available
  })

  const favorites = useMemo(() => (available ? (data ?? []) : []), [available, data])
  const ids = useMemo(() => new Set(favorites.map((f) => f.account.id)), [favorites])
  const isFavorite = useCallback((accountId: string) => ids.has(accountId), [ids])

  return { available, favorites, isFavorite }
}

/**
 * Stars a player or unstars them, and answers with why not when a star is
 * refused — a full list is somebody's to trim, not something to trim for them.
 */
export function useToggleFavorite(): (player: PlayerSearchResult, starred: boolean) => Promise<string | null> {
  const client = useClient()
  const queryClient = useQueryClient()

  return useCallback(
    async (player, starred) => {
      if (starred) {
        queryClient.setQueryData(queryKeys.favorites(), await client.favorites.remove(player.account.id))
        return null
      }

      const outcome = await client.favorites.add(player)
      queryClient.setQueryData(queryKeys.favorites(), outcome.favorites)
      return outcome.ok ? null : FAVORITES_FULL
    },
    [client, queryClient]
  )
}

/**
 * Brings any starred player among these up to date.
 *
 * The check runs against the cached list first, so a page of suggestions with
 * nobody starred in it — which is most of them — costs nothing at all; only a
 * copy that actually changed is written back.
 */
export function useFavoritesRefresher(): (seen: readonly PlayerSearchResult[]) => void {
  const client = useClient()
  const queryClient = useQueryClient()

  return useCallback(
    (seen) => {
      const cached = queryClient.getQueryData<FavoritePlayer[]>(queryKeys.favorites())
      if (!cached || refreshFavorites(cached, seen) === null) return

      void client.favorites
        .refresh([...seen])
        .then((favorites) => queryClient.setQueryData(queryKeys.favorites(), favorites))
        .catch(() => undefined)
    },
    [client, queryClient]
  )
}

/** `useFavoritesRefresher`, run whenever a fresh list of players arrives. Undefined is nothing yet. */
export function useRefreshFavorites(seen: readonly PlayerSearchResult[] | undefined): void {
  const { available } = useFavorites()
  const refresh = useFavoritesRefresher()

  useEffect(() => {
    if (available && seen && seen.length > 0) refresh(seen)
  }, [available, seen, refresh])
}
