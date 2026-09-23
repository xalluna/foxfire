import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { LeagueAccountsPage } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'

/** The League accounts this server keeps history for, and who owns them. */
export function LeagueAccountsScreen(): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()

  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
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
      accounts={accounts.data}
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
