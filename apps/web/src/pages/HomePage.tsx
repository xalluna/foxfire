import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { EmptyState, Icon } from '@foxfire/ui'
import { searchShortcutLabel, useHomeAccount } from '@foxfire/screens'
import { useAuth } from '../session/session'

/**
 * Where `/` goes: the account this browser opens on, else the first one you
 * claimed — never a stranger's profile.
 *
 * With neither there is no profile to open, so this says how to get one and
 * where everybody else is. It used to open the list of everybody instead, a
 * page that is now the search box in the header.
 *
 * Somebody reading an open server without an account has nothing claimed, so
 * unless this browser remembers a profile to open on, they are pointed at the
 * search box. (Somebody on a share link never arrives here: `/` sends them to
 * the profile they were given.)
 *
 * The choosing is done by the client's `getHome`; see homeAmong.
 */
export function HomePage(): JSX.Element | null {
  const found = useHomeAccount()
  const signedIn = useAuth((s) => s.user !== null)

  if (found.isPending) return null

  const home = found.data
  if (home) return <Navigate to="/players/$slug" params={{ slug: playerSlug(home) }} replace />

  const shortcut = searchShortcutLabel(navigator.platform)

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <EmptyState
        icon={<Icon.Search />}
        title={signedIn ? 'Nobody to show yet' : 'Look somebody up'}
        description={
          signedIn
            ? `Claim your League account by signing in to it in the League client with Foxfire desktop connected to this server. Anybody else here is in the search box at the top — press ${shortcut}.`
            : `Everybody this server keeps is in the search box at the top — press ${shortcut}. Their games, ranks and champions are open to read; signing in is for the people who play here.`
        }
      />
    </div>
  )
}
