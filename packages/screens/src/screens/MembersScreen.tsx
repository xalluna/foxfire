import { useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { MembersPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useConnection, useIsHeadAdmin } from '../client/useConnection'
import { useDebounced } from '../hooks/useDebounced'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems, pageTotal } from '../queries/paging'

/** Members per page. */
const PAGE_SIZE = 50

/**
 * The people on the server you administer, and what can be done about them.
 *
 * A page at a time, searched by the server: a community big enough to need the
 * search box is exactly the one a whole list stops working for.
 */
export function MembersScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const connection = useConnection()
  const isHeadAdmin = useIsHeadAdmin()

  const [query, setQuery] = useState('')
  const asked = useDebounced(query.trim())

  const users = useInfiniteQuery({
    queryKey: queryKeys.admin.users(asked),
    queryFn: ({ pageParam }) => client.admin.users({ q: asked, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
    // The list holds still while the next search is asked, rather than
    // collapsing to "Loading…" at every pause in typing.
    placeholderData: keepPreviousData
  })

  /**
   * Everything under the admin key, not just the members.
   *
   * Removing somebody changes what an invite says — a spent one starts reading
   * "an account since deleted" — and the two lists are on different pages now,
   * so the one not being looked at is exactly the one that would go stale.
   */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() })
  }

  const thenRefresh = async <T,>(run: Promise<T>): Promise<T> => {
    try {
      return await run
    } finally {
      refresh()
    }
  }

  return (
    <MembersPage
      users={pageItems(users.data, (user) => user.id)}
      total={pageTotal(users.data)}
      usersLoading={users.isPending}
      query={query}
      onQueryChange={setQuery}
      hasMore={users.hasNextPage}
      loadingMore={users.isFetchingNextPage}
      onShowMore={() => void users.fetchNextPage()}
      signedInAs={connection?.session?.email ?? null}
      canManageAdmins={isHeadAdmin}
      onUpdateUser={(id, patch): Promise<AdminActionResult> =>
        thenRefresh(client.admin.updateUser(id, patch))
      }
      onDeleteUser={(id) => thenRefresh(client.admin.deleteUser(id))}
      onCreatePasswordReset={(id) => thenRefresh(client.admin.createPasswordReset(id))}
      onRevokePasswordReset={(id) => thenRefresh(client.admin.revokePasswordReset(id))}
      onCopy={(text) => void platform.copyText(text)}
    />
  )
}
