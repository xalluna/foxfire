import type { FoxfireData } from '../client'
import { addFavorite, parseFavorites, refreshFavorites, removeFavorite, serializeFavorites } from '../rules/favorites'

/**
 * Where a client keeps its starred players: one string, read and written whole.
 *
 * The same place as the home account and for the same reason — who somebody
 * keeps an eye on is a preference of the PC or browser they do it from, not a
 * thing a server holds one answer to.
 */
export interface FavoritesStore {
  get(): string | null
  set(serialized: string): void
}

/**
 * The favorites half of the contract, over whatever store the caller keeps.
 *
 * Nothing is written that did not change: a refused star, a refresh that found
 * everybody as they were. A search box refreshes on every page of suggestions,
 * and a write per keystroke would be a write per keystroke for nothing.
 */
export function favoritesOver(
  store: FavoritesStore,
  now: () => string = () => new Date().toISOString()
): FoxfireData['favorites'] {
  const read = () => parseFavorites(store.get())

  return {
    list: async () => read(),

    add: async (player) => {
      const outcome = addFavorite(read(), player, now())
      if (outcome.ok) store.set(serializeFavorites(outcome.favorites))
      return outcome
    },

    remove: async (accountId) => {
      const list = read()
      const favorites = removeFavorite(list, accountId)
      if (favorites.length !== list.length) store.set(serializeFavorites(favorites))
      return favorites
    },

    refresh: async (seen) => {
      const list = read()
      const favorites = refreshFavorites(list, seen)
      if (favorites === null) return list
      store.set(serializeFavorites(favorites))
      return favorites
    }
  }
}
