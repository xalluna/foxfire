import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { EmptyState, Icon } from '@foxfire/ui'
import { searchShortcutLabel, useHomeAccount } from '@foxfire/screens'

/**
 * Where `/` goes: the account this browser opens on, else the first one you
 * claimed — never a stranger's profile.
 *
 * With neither there is no profile to open, so this says how to get one and
 * where everybody else is. It used to open the list of everybody instead, a
 * page that is now the search box in the header.
 *
 * The choosing is done by the client's `getHome`; see homeAmong.
 */
export function HomePage(): JSX.Element | null {
  const found = useHomeAccount()

  if (found.isPending) return null

  const home = found.data
  if (home) return <Navigate to="/players/$slug" params={{ slug: playerSlug(home) }} replace />

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <EmptyState
        icon={<Icon.Search />}
        title="Nobody to show yet"
        description={`Claim your League account by signing in to it in the League client with Foxfire desktop connected to this server. Anybody else here is in the search box at the top — press ${searchShortcutLabel(navigator.platform)}.`}
      />
    </div>
  )
}
