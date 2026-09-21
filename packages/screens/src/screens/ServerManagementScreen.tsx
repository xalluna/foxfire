import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { ServerManagementPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { queryKeys } from '../queries/keys'

/** People and access on the server you administer: sign-up, invites, members. */
export function ServerManagementScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()

  const users = useQuery({ queryKey: queryKeys.admin.users(), queryFn: () => client.admin.users() })
  const invites = useQuery({ queryKey: queryKeys.admin.invites(), queryFn: () => client.admin.invites() })
  const settings = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: () => client.admin.getSettings()
  })

  /** Every action here can change what all three lists show. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.invites() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings() })
  }

  const thenRefresh = async <T,>(run: Promise<T>): Promise<T> => {
    try {
      return await run
    } finally {
      refresh()
    }
  }

  return (
    <ServerManagementPage
      users={users.data ?? []}
      usersLoading={users.isPending}
      invites={invites.data ?? []}
      invitesLoading={invites.isPending}
      publicSignup={settings.data?.publicSignup ?? true}
      settingsLoading={settings.isPending}
      onSetPublicSignup={async (on) => {
        await thenRefresh(client.admin.setSettings({ publicSignup: on }))
      }}
      onCreateInvite={(email) => thenRefresh(client.admin.createInvite(email))}
      onRevokeInvite={(id): Promise<AdminActionResult> => thenRefresh(client.admin.revokeInvite(id))}
      onUpdateUser={(id, patch) => thenRefresh(client.admin.updateUser(id, patch))}
      onDeleteUser={(id) => thenRefresh(client.admin.deleteUser(id))}
      onCopy={(text) => void platform.copyText(text)}
    />
  )
}
