import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { EmptyState, Icon } from '@foxfire/ui'
import { useHomeAccount } from '@foxfire/screens'
import { PlayerLayout } from '../components/PlayerLayout'
import { useServerHealth } from '../hooks/useKeyStatus'

/**
 * Where the main window opens: the home account's profile, else your first.
 *
 * With nothing to open there is no profile to show, so this is the page that
 * says so, and where the first one comes from — the rail locally, the League
 * client and Settings › Server on a server. On a server that is somebody who
 * has claimed nothing yet, and it used to open on the first account the server
 * had at all: a stranger's history, picked out of a list of everybody that
 * nothing fetches any more.
 */
export function Home(): JSX.Element {
  const { connected } = useServerHealth()
  const home = useHomeAccount()

  if (home.isPending) return <PlayerLayout account={null}>{null}</PlayerLayout>

  if (home.data) {
    return <Navigate to="/players/$slug" params={{ slug: playerSlug(home.data) }} replace />
  }

  return (
    <PlayerLayout account={null}>
      {connected ? (
        <EmptyState
          icon={<Icon.Plus />}
          title="No League account of yours yet"
          description="Sign in to it in the League client, then link it from Settings › Server. Anybody else on this server is in Search."
        />
      ) : (
        <EmptyState
          icon={<Icon.Plus />}
          title="No accounts yet"
          description="Add a Riot ID from the rail on the left to start tracking matches, rank and champion stats."
        />
      )}
    </PlayerLayout>
  )
}
