import { useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys, useClient, type PlayerLayoutProps } from '@foxfire/screens'
import { useLastPlayer } from '../store/lastPlayer'
import { AccountSwitcher } from './AccountSwitcher'

/** The scrolling content area every main-window page draws into. */
export function Main({ children }: { children: ReactNode }): JSX.Element {
  return <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
}

/**
 * The account rail beside a player's pages.
 *
 * Also drawn with no account at all — while accounts load, on "no player by
 * that name", and on the empty first run — because the rail is where an account
 * gets picked, and locally where one gets added, which is the way out of each
 * of those.
 */
export function PlayerLayout({ account, children }: PlayerLayoutProps): JSX.Element {
  const client = useClient()
  const remember = useLastPlayer((s) => s.remember)

  const accounts = useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: () => client.accounts.list()
  })

  useEffect(() => {
    if (account) remember(account.id)
  }, [account, remember])

  return (
    <>
      <AccountSwitcher accounts={accounts.data ?? []} activeAccountId={account?.id ?? null} />
      <Main>{children}</Main>
    </>
  )
}
