import { Link } from '@tanstack/react-router'
import type { Account, GameId } from '@foxfire/core'
import { playerSlug } from '@foxfire/core/routes'
import { Icon } from '@foxfire/ui'

/**
 * The way back to a player's profile from a page that hangs off it — the Rank
 * and Champions pages, a game on its own page, a recording.
 *
 * It names the player rather than saying "Back", because it is not history:
 * whoever arrived from a shared link has nowhere to go back to, and it still
 * has to go somewhere. `label` says what of theirs it returns to.
 *
 * No queue in the link, so the profile opens on the one it last showed —
 * rememberSearch on the dashboard route fills it in. `match` asks the profile
 * to open that game where it sits in the history. `game` is whose profile: a
 * TFT page goes back to the TFT one.
 */
export function PlayerBackLink({
  account,
  label,
  match,
  game = 'lol'
}: {
  account: Account
  label: 'profile' | 'history'
  match?: string
  game?: GameId
}): JSX.Element {
  return (
    <Link
      // The router's types are registered by each app, not here.
      to={(game === 'tft' ? '/players/$slug/tft' : '/players/$slug') as never}
      params={{ slug: playerSlug(account) } as never}
      search={(match === undefined ? undefined : { match }) as never}
      className="inline-flex items-center gap-1.5 text-sm text-text-dim transition hover:text-accent"
    >
      <Icon.ChevronDown width={14} height={14} className="rotate-90" />
      {account.gameName}&rsquo;s {label}
    </Link>
  )
}
