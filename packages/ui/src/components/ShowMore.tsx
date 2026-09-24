import { ghostButtonClass } from './settings/controls'

/**
 * Asks for the next page of a list that is fetched a page at a time.
 *
 * A button rather than a scroll that loads by itself, because every list here
 * is one somebody might want to reach the end of on purpose — and a button says
 * how far they have come and what another press will cost. Two looks for the
 * two places lists live: `row` closes a list of rows edge to edge, `settings`
 * sits under the rows of a settings card.
 */
export function ShowMoreButton({
  onClick,
  loading,
  variant = 'row'
}: {
  onClick: () => void
  loading: boolean
  variant?: 'row' | 'settings'
}): JSX.Element {
  const label = loading ? 'Loading…' : 'Show more'

  if (variant === 'settings') {
    return (
      <div className="flex justify-center px-4 py-3">
        <button type="button" className={ghostButtonClass} onClick={onClick} disabled={loading}>
          {label}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="w-full border-t border-hairline py-2.5 text-sm text-text-dim transition hover:bg-surface hover:text-accent disabled:opacity-50"
    >
      {label}
    </button>
  )
}
