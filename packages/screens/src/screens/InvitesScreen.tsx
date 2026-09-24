import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { InvitesPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { queryKeys } from '../queries/keys'

/** How somebody gets an account on the server you administer. */
export function InvitesScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()

  const invites = useQuery({
    queryKey: queryKeys.admin.invites(),
    queryFn: () => client.admin.invites()
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
      invites={invites.data ?? []}
      invitesLoading={invites.isPending}
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
