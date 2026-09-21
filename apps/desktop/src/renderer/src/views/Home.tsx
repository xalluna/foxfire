import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { EmptyState, Icon } from '@foxfire/ui'
import { queryKeys, useClient } from '@foxfire/screens'
import { PlayerLayout } from '../components/PlayerLayout'

/**
 * Where the main window opens: the home account's profile, or the first
 * account's when none is marked home.
 *
 * With no accounts at all there is no profile to open, so this is the page that
 * says so — beside the rail, which is where the first one is added.
 */
export function Home(): JSX.Element {
  const client = useClient()

  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  if (accounts.isPending) return <PlayerLayout account={null}>{null}</PlayerLayout>

  const list = accounts.data ?? []
  const home = list.find((a) => a.isHomeAccount) ?? list[0]
  if (home) return <Navigate to="/players/$slug" params={{ slug: playerSlug(home) }} replace />

  return (
    <PlayerLayout account={null}>
      <EmptyState
        icon={<Icon.Plus />}
        title="No accounts yet"
        description="Add a Riot ID from the rail on the left to start tracking matches, rank and champion stats."
      />
    </PlayerLayout>
  )
}
