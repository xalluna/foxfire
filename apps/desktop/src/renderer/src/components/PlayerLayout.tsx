import { useEffect, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { GameSwitch, useMyAccounts, type PlayerLayoutProps } from '@foxfire/screens'
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
  const remember = useLastPlayer((s) => s.remember)
  const onCaptures = useRouterState({ select: (s) => /\/captures\/?$/.test(s.location.pathname) })
  const accounts = useMyAccounts()

  useEffect(() => {
    if (account) remember(account.id)
  }, [account, remember])

  return (
    <>
      <AccountSwitcher accounts={accounts.data ?? []} activeAccountId={account?.id ?? null} />
      <Main>
        {/* Which of the player's games this is. The desktop has no tabs — its
            other pages open from the cards that summarise them — so the switch
            is the one thing above the page. Not on Captures, which is this
            PC's recordings of both games and has a filter of its own. */}
        {account && !onCaptures && (
          <div className="flex justify-end px-4 pt-3">
            <GameSwitch account={account} />
          </div>
        )}
        {children}
      </Main>
    </>
  )
}
