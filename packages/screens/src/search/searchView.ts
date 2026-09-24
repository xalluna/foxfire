import type { FavoritePlayer, PlayerSearchResult } from '@foxfire/core'
import type { PlayerSearchSection } from '@foxfire/ui'

/**
 * How many characters before the box asks a server anything.
 *
 * Riot names are at least three long, and one or two letters match most of a
 * community — a list that answers nobody's question and costs a request.
 */
export const MIN_QUERY_LENGTH = 3

/** Suggestions shown for what was typed. A box to pick from, not a list to browse. */
export const SUGGESTION_LIMIT = 10

export interface SearchViewInput {
  /** What is in the box right now. */
  query: string
  /** The query the suggestions below were asked for: trimmed, and settled after typing stops. */
  asked: string
  /** Null where nobody can be starred, and the list has no Favorites section. */
  favorites: readonly FavoritePlayer[] | null
  yours: { players: readonly PlayerSearchResult[] | undefined; loading: boolean }
  suggestions: {
    /** Undefined before the first answer; the previous query's while the next is asked. */
    players: readonly PlayerSearchResult[] | undefined
    /** The players are a previous query's, kept on screen while this one is asked. */
    stale: boolean
    failed: boolean
  }
}

export interface SearchView {
  sections: PlayerSearchSection[]
  status: string | null
}

/**
 * What the search box's list shows, for what is typed so far.
 *
 * Under three characters it is what the box opens on, unfiltered — your
 * favorites, then your own accounts — with a word about why typing has not
 * narrowed it yet. From three it is the server's suggestions, the last answer
 * kept on screen while the next is asked so the list holds still mid-word.
 */
export function searchView(input: SearchViewInput): SearchView {
  const typed = input.query.trim()

  if (typed.length < MIN_QUERY_LENGTH) {
    const sections: PlayerSearchSection[] = []

    if (input.favorites !== null) {
      sections.push({
        key: 'favorites',
        label: 'Favorites',
        players: input.favorites,
        empty: 'Star a player to keep them here.'
      })
    }

    sections.push({
      key: 'yours',
      label: 'Your accounts',
      players: input.yours.players ?? [],
      loading: input.yours.loading,
      empty: 'No League account of yours yet.'
    })

    return {
      sections,
      status: typed.length > 0 ? `Type ${MIN_QUERY_LENGTH}+ characters to search` : null
    }
  }

  const { players, stale, failed } = input.suggestions
  const current = input.asked === typed && !stale

  if (failed && current) return { sections: [], status: 'Could not search just now.' }
  if (!players || (!current && players.length === 0)) return { sections: [], status: 'Searching…' }
  if (players.length === 0) return { sections: [], status: `No player named “${typed}” on this server` }

  return { sections: [{ key: 'results', label: null, players }], status: null }
}

/** "⌘K" where the key is Command, "Ctrl K" everywhere else. */
export function searchShortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K'
}
