import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { useHomeAccount } from '@foxfire/screens'

/**
 * Where `/` goes: the account this browser opens on, else the first one you
 * claimed, else the list of everybody — never a stranger's profile.
 *
 * The choosing is done by the client's `getHome`; see homeAmong.
 */
export function HomePage(): JSX.Element | null {
  const found = useHomeAccount()

  if (found.isPending) return null

  const home = found.data
  return home ? (
    <Navigate to="/players/$slug" params={{ slug: playerSlug(home) }} replace />
  ) : (
    <Navigate to="/players" replace />
  )
}
