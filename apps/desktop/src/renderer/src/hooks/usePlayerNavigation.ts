import { useCallback } from 'react'
import { useMatchRoute, useNavigate, useParams } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { useAccount, useHomeAccount } from '@foxfire/screens'
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
 * screen last, else the home account. Null when there is nobody to open.
 */
export function useNavSlug(): string | null {
  const { slug } = useParams({ strict: false })
  const lastAccountId = useLastPlayer((s) => s.accountId)

  // Asked only when the page names nobody, and each by itself: whoever was on
  // screen last may be anybody on the server, and is one lookup rather than a
  // reason to hold every account.
  const last = useAccount(slug === undefined ? lastAccountId : null)
  const home = useHomeAccount()

  if (slug !== undefined) return slug

  const target = last.data ?? home.data
  return target ? playerSlug(target) : null
}
