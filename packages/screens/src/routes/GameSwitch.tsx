import clsx from 'clsx'
import { Link, useRouterState } from '@tanstack/react-router'
import type { Account } from '@foxfire/core'
import { GAMES } from '@foxfire/core'
import { gameOfPlayerPath, playerSlug } from '@foxfire/core/routes'

/**
 * League | TFT, on a player's pages.
 *
 * A player is a Riot ID, and the same Riot ID has a history in each game, so
 * the switch moves between the two profiles of one person rather than between
 * two apps. Which side is lit is read off the address: everything under a
 * player is League's except what is under `/tft`, which is also how a shared
 * link opens on the right one.
 *
 * Links rather than buttons, so a middle-click opens the other game in a tab
 * in a browser, and the address is the whole of the state.
 */
export function GameSwitch({ account, className }: { account: Account; className?: string }): JSX.Element {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const game = gameOfPlayerPath(pathname)
  const slug = playerSlug(account)

  const option = (to: '/players/$slug' | '/players/$slug/tft', active: boolean, label: string): JSX.Element => (
    <Link
      // The router's types are registered by each app, not here.
      to={to as never}
      params={{ slug } as never}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex items-center px-3 transition',
        active ? 'bg-accent/10 text-accent' : 'text-text-dim hover:bg-surface hover:text-text'
      )}
    >
      {label}
    </Link>
  )

  return (
    <nav
      aria-label="Game"
      className={clsx('flex h-8 shrink-0 overflow-hidden rounded-md border border-hairline text-sm', className)}
    >
      {option('/players/$slug', game === 'lol', GAMES.lol.shortName)}
      {option('/players/$slug/tft', game === 'tft', GAMES.tft.shortName)}
    </nav>
  )
}
