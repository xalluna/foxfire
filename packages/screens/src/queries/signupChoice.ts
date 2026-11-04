import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useClient } from '../client/context'
import { queryKeys } from './keys'

/**
 * Whether this server's owner still has to say who may make an account, and
 * the way to say it.
 *
 * Only a server from before new ones started invite-only can need to: open, by
 * a default nobody was told about. A server too old to report it is read as
 * having chosen, so nothing asks a question it cannot record. Reads the admin
 * settings, so only ask for it where the reader is an admin.
 */
export function useSignupChoice(enabled = true): {
  unchosen: boolean
  choose: (open: boolean) => Promise<void>
} {
  const client = useClient()
  const queryClient = useQueryClient()

  const settings = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: () => client.admin.getSettings(),
    enabled
  })

  return {
    unchosen: settings.data?.publicSignup === true && settings.data.publicSignupChosen === false,
    choose: async (open) => {
      try {
        await client.admin.setSettings({ publicSignup: open })
      } finally {
        void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() })
      }
    }
  }
}
