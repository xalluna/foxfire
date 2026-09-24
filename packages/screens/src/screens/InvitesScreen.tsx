import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { InvitesPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems } from '../queries/paging'

/** Used invites per page. */
const PAGE_SIZE = 50

/** How somebody gets an account on the server you administer. */
export function InvitesScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()

  // The open ones whole — they expire, so there are never many — and the used
  // ones, which are everybody who ever joined this way, a page at a time.
  const outstanding = useQuery({
    queryKey: queryKeys.admin.openInvites(),
    queryFn: () => client.admin.openInvites()
  })

  const used = useInfiniteQuery({
    queryKey: queryKeys.admin.usedInvites(),
    queryFn: ({ pageParam }) => client.admin.usedInvites({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  const settings = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: () => client.admin.getSettings()
  })

  /** Under one key, because taking an invite adds a member and spends the invite. */
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
    <InvitesPage
      outstanding={outstanding.data ?? []}
      used={pageItems(used.data, (invite) => invite.id)}
      invitesLoading={outstanding.isPending || used.isPending}
      hasMoreUsed={used.hasNextPage}
      loadingMoreUsed={used.isFetchingNextPage}
      onShowMoreUsed={() => void used.fetchNextPage()}
      publicSignup={settings.data?.publicSignup ?? true}
      settingsLoading={settings.isPending}
      onSetPublicSignup={async (on) => {
        await thenRefresh(client.admin.setSettings({ publicSignup: on }))
      }}
      onCreateInvite={(email) => thenRefresh(client.admin.createInvite(email))}
      onRevokeInvite={(id): Promise<AdminActionResult> => thenRefresh(client.admin.revokeInvite(id))}
      onCopy={(text) => void platform.copyText(text)}
    />
  )
}
