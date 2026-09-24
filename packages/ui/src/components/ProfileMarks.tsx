import clsx from 'clsx'
import * as Icon from './icons'

export interface FavoriteMark {
  starred: boolean
  onToggle: () => void
}

export interface HomeMark {
  isHome: boolean
  onSetHome: () => void
  /** Where the preference lives, for the tooltip: "this PC", "this browser". */
  where: string
}

const markClass =
  'inline-flex shrink-0 items-center justify-center rounded-md border border-hairline p-1.5 transition'

/**
 * The star and the house on a profile: keep this player in the search box,
 * and open on them.
 *
 * Both are about the machine or browser rather than the player — neither
 * reaches a server — which is why they sit together, beside Copy link, rather
 * than with Sync, which does.
 *
 * The star is absent where nobody can be starred (a desktop with no server,
 * whose accounts are all on the rail already). The house cannot be clicked off:
 * something has to be home, and the way to move it is to set it somewhere else.
 */
export function ProfileMarks({
  favorite,
  home,
  className
}: {
  favorite?: FavoriteMark
  home?: HomeMark
  className?: string
}): JSX.Element | null {
  if (!favorite && !home) return null

  return (
    <div className={clsx('flex shrink-0 items-center gap-1.5', className)}>
      {favorite && (
        <button
          type="button"
          aria-pressed={favorite.starred}
          aria-label={favorite.starred ? 'Remove from favorites' : 'Add to favorites'}
          title={favorite.starred ? 'Remove from favorites' : 'Add to favorites'}
          onClick={favorite.onToggle}
          className={clsx(
            markClass,
            favorite.starred
              ? 'border-accent-dim text-accent'
              : 'text-text-dim hover:border-accent-dim hover:text-accent'
          )}
        >
          <Icon.Star width={14} height={14} filled={favorite.starred} />
        </button>
      )}
      {home && (
        <button
          type="button"
          aria-pressed={home.isHome}
          aria-label={home.isHome ? `Home account on ${home.where}` : `Open on this account on ${home.where}`}
          title={home.isHome ? `${capitalise(home.where)} opens on this account` : `Open on this account on ${home.where}`}
          onClick={home.onSetHome}
          disabled={home.isHome}
          className={clsx(
            markClass,
            home.isHome
              ? 'cursor-default border-accent-dim text-accent'
              : 'text-text-dim hover:border-accent-dim hover:text-accent'
          )}
        >
          <Icon.Home width={14} height={14} filled={home.isHome} />
        </button>
      )}
    </div>
  )
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
