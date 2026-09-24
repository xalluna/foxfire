import { useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { LeagueAccountsPage } from '@foxfire/ui'
import { useClient } from '../client/context'
import { useDebounced } from '../hooks/useDebounced'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems } from '../queries/paging'

/** Claims per page. Half of what a server answers one search with. */
const PAGE_SIZE = 50

/**
 * The League accounts this server keeps history for, and who owns them.
 *
 * Neither half reads every account. The count is the one the storage page
 * already keeps, and the claims are the finder asked for claimed accounts only,
 * a page at a time and filtered by name — a community's worth of claims is not
 * a list to fetch in one go.
 */
export function LeagueAccountsScreen(): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState('')
  const asked = useDebounced(query)

  const storage = useQuery({ queryKey: queryKeys.admin.storage(), queryFn: () => client.admin.storage() })

  const claimed = useInfiniteQuery({
    queryKey: queryKeys.playerSearch(asked, 'claimed'),
    queryFn: ({ pageParam }) =>
      client.search.players(asked, { claimed: true, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    placeholderData: keepPreviousData
  })

  /**
   * Adding or unlinking changes who is in the finder and what it says about
   * them, so both lists go at once. Storage too for an add, which starts a
   * backfill that will grow what the server is holding.
   */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.playerSearches() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.storage() })
  }

  return (
    <LeagueAccountsPage
      tracked={storage.data?.riotAccounts}
      claimed={
        claimed.data === undefined
          ? undefined
          : pageItems(claimed.data, (player) => player.account.id).map((player) => player.account)
      }
      claimedQuery={query}
      onClaimedQueryChange={setQuery}
      hasMoreClaimed={claimed.hasNextPage}
      loadingMoreClaimed={claimed.isFetchingNextPage}
      onShowMoreClaimed={() => void claimed.fetchNextPage()}
      onAddAccount={async (input) => {
        const account = await client.admin.addRiotAccount(input)
        refresh()
        return account
      }}
      onUnlink={async (accountId): Promise<AdminActionResult> => {
        const outcome = await client.admin.forceUnlink(accountId)
        if (outcome.ok) refresh()
        return outcome
      }}
    />
  )
}
