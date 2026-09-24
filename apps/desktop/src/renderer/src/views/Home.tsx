import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { EmptyState, Icon } from '@foxfire/ui'
import { queryKeys, useClient } from '@foxfire/screens'
import { PlayerLayout } from '../components/PlayerLayout'
import { useServerHealth } from '../hooks/useKeyStatus'

/**
 * Where the main window opens: the home account's profile, or the first
 * account's when none is marked home.
 *
 * With no accounts at all there is no profile to open, so this is the page that
 * says so, and where the first one comes from — the rail locally, the League
 * client and Settings › Server on a server that tracks nobody yet.
 */
export function Home(): JSX.Element {
  const client = useClient()
  const { connected } = useServerHealth()

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
        description={
          connected
            ? 'Sign in to your account in the League client, then link it from Settings › Server to start tracking matches, rank and champion stats.'
            : 'Add a Riot ID from the rail on the left to start tracking matches, rank and champion stats.'
        }
      />
    </PlayerLayout>
  )
}
