import { useQuery } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import { playerSlug } from '@foxfire/core/routes'
import { queryKeys, useClient } from '@foxfire/screens'

/**
 * Where `/` goes: the account this browser opens on, else the first one you
 * claimed, else the list of everybody — never a stranger's profile.
 *
 * The choosing is done by the account list itself; see applyHomeAccount.
 */
export function HomePage(): JSX.Element | null {
  const client = useClient()
  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  if (accounts.isPending) return null

  const home = accounts.data?.find((a) => a.isHomeAccount)
  return home ? (
    <Navigate to="/players/$slug" params={{ slug: playerSlug(home) }} replace />
  ) : (
    <Navigate to="/players" replace />
  )
}
