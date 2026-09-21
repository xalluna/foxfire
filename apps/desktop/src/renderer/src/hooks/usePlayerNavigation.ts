import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMatchRoute, useNavigate, useParams } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { queryKeys, useClient } from '@foxfire/screens'
import { useLastPlayer } from '../store/lastPlayer'

/**
 * Show another account, on the page already open.
 *
 * Picking an account from the rail on the Champions page should land on that
 * account's champions, as it did when the page was a store value and the
 * account another. The remembered queue filters come along on their own —
 * see rememberSearch — and anything else about the old account's page does not.
 */
export function useSwitchPlayer(): (account: Account) => void {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()

  return useCallback(
    (account: Account) => {
      const slug = playerSlug(account)
      const onPlayerPage = matchRoute({ to: '/players/$slug', fuzzy: true, includeSearch: false })

      if (onPlayerPage) void navigate({ to: '.', params: { slug } as never })
      else void navigate({ to: '/players/$slug', params: { slug } })
    },
    [navigate, matchRoute]
  )
}

/**
 * Whose pages the nav links open: the player on screen, else whoever was on
 * screen last, else the home account. Null when there are no accounts at all.
 */
export function useNavSlug(): string | null {
  const client = useClient()
  const { slug } = useParams({ strict: false })
  const lastAccountId = useLastPlayer((s) => s.accountId)

  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  if (slug !== undefined) return slug

  const list = accounts.data ?? []
  const target =
    list.find((a) => a.id === lastAccountId) ?? list.find((a) => a.isHomeAccount) ?? list[0]
  return target ? playerSlug(target) : null
}
