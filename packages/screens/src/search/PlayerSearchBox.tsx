import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Page, PlayerSearchResult } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { PlayerSearch } from '@foxfire/ui'
import { useClient } from '../client/context'
import { useDebounced } from '../hooks/useDebounced'
import { useFavorites, useFavoritesRefresher, useRefreshFavorites, useToggleFavorite } from '../queries/favorites'
import { queryKeys } from '../queries/keys'
import { MIN_QUERY_LENGTH, SUGGESTION_LIMIT, searchShortcutLabel, searchView } from './searchView'

/**
 * The players on a page of search. The box shows a page and never says how
 * many more there are: ten is a list to pick from, not one to page through.
 * At module scope so the selected list keeps its identity between renders.
 */
const playersOf = (page: Page<PlayerSearchResult>): PlayerSearchResult[] => page.items

/**
 * Finding somebody, from the header of every page.
 *
 * It replaced a page of its own, which meant leaving whatever you were looking
 * at to look somebody up. Clicked into, it offers the players you starred and
 * your own accounts; from three characters, up to ten of the server's closest
 * matches. Picking one opens their profile, from anywhere.
 *
 * Answered out of the server's own tables, as the page was — no Riot call —
 * and the suggestions are a query, so typing the same name twice asks once.
 */
export function PlayerSearchBox({ className }: { className?: string }): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { available, favorites, isFavorite } = useFavorites()
  const toggleFavorite = useToggleFavorite()
  const refreshFavorites = useFavoritesRefresher()

  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const asked = useDebounced(query.trim())
  const suggest = (text: string) => ({
    queryKey: queryKeys.playerSearch(text, 'suggest'),
    queryFn: () => client.search.players(text, { limit: SUGGESTION_LIMIT })
  })

  const suggestions = useQuery({
    ...suggest(asked),
    select: playersOf,
    enabled: asked.length >= MIN_QUERY_LENGTH,
    placeholderData: keepPreviousData
  })

  // Asked for when the list first opens, not with every page that has a header.
  const yours = useQuery({
    queryKey: queryKeys.playerSearch('', 'mine'),
    queryFn: () => client.search.players('', { mine: true, limit: 100 }),
    select: playersOf,
    enabled: opened
  })

  useRefreshFavorites(suggestions.isPlaceholderData ? undefined : suggestions.data)
  useRefreshFavorites(yours.data)

  // A refused star is about the list it was refused from.
  useEffect(() => setNotice(null), [query])

  const view = searchView({
    query,
    asked,
    favorites: available ? favorites : null,
    yours: { players: yours.data, loading: yours.isPending && opened },
    suggestions: {
      players: suggestions.data,
      stale: suggestions.isPlaceholderData || suggestions.isFetching,
      failed: suggestions.isError
    }
  })

  async function open(player: PlayerSearchResult): Promise<void> {
    setQuery('')
    setNotice(null)

    // A favorite is a copy from whenever it was last seen, and somebody who
    // has renamed since would be looked for under the old name. Asked by id
    // first — usually cached — so the link is the name they have now.
    let { account } = player
    if (isFavorite(account.id)) {
      const fresh = await queryClient
        .fetchQuery({
          queryKey: queryKeys.account(account.id),
          queryFn: () => client.accounts.get(account.id),
          staleTime: 60_000
        })
        .catch(() => null)

      if (fresh) {
        account = fresh
        refreshFavorites([{ account: fresh, soloEntry: player.soloEntry }])
      }
    }

    void navigate({ to: '/players/$slug', params: { slug: playerSlug(account) } })
  }

  return (
    <PlayerSearch
      className={className}
      query={query}
      onQueryChange={setQuery}
      sections={view.sections}
      status={view.status}
      notice={notice}
      isFavorite={isFavorite}
      onToggleFavorite={
        available
          ? (player) => void toggleFavorite(player, isFavorite(player.account.id)).then(setNotice)
          : undefined
      }
      onPick={(player) => void open(player)}
      // Enter with nothing highlighted is the closest match for what is in the
      // box now — asked for if the answer on screen is still an earlier one.
      onSubmit={async () => {
        const typed = query.trim()
        if (typed.length < MIN_QUERY_LENGTH) return null
        const page = await queryClient.ensureQueryData(suggest(typed)).catch(() => null)
        return page?.items[0] ?? null
      }}
      onOpen={() => setOpened(true)}
      shortcut={searchShortcutLabel(typeof navigator === 'undefined' ? '' : navigator.platform)}
      placeholder="Search players"
    />
  )
}
