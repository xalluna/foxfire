import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { MembersPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from '../queries/keys'

/** Everybody on the server you administer, and what can be done about them. */
export function MembersScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const connection = useConnection()

  const users = useQuery({ queryKey: queryKeys.admin.users(), queryFn: () => client.admin.users() })

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
      users={users.data ?? []}
      usersLoading={users.isPending}
      signedInAs={connection?.session?.email ?? null}
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
