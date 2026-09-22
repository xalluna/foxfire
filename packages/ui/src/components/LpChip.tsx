import clsx from 'clsx'
import type { MatchRankInfo } from '@foxfire/core'
import { formatTierShort, tierColor, tierCrest, tierLabel } from '../lib/rank'

/**
 * What a game was worth, in the match row's leftmost column.
 *
 * Renders nothing at all when LP is unknown — no dash, no placeholder. Riot
 * publishes no per-match LP, so games played before rank tracking began can
 * never be attributed, and an empty slot is the honest representation of that
 * rather than a value the app had to invent.
 *
 * Promotions replace the number with the tier crest, which is the moment worth
 * showing; demotions keep the LP figure and get only a dimmed crest, so the two
 * read differently at a glance without the bad news shouting.
 */
export function LpChip({ rank }: { rank: MatchRankInfo | null }): JSX.Element | null {
  if (!rank || rank.lpDelta === null) return null

  const gained = rank.lpDelta > 0
  const arrow = gained ? '▲' : '▼'
  const crest = tierCrest(rank.tierAfter)
  const short = formatTierShort(rank.tierAfter, rank.rankAfter)
  const fullLabel = tierLabel(rank.tierAfter, rank.rankAfter)

  if (rank.isPromotion && crest && short) {
    return (
      <p
        className="flex items-center gap-1 whitespace-nowrap text-2xs font-medium"
        style={{ color: tierColor(rank.tierAfter) }}
        title={`Promoted to ${fullLabel}`}
      >
        <span aria-hidden>{arrow}</span>
        <img src={crest} alt="" className="h-3.5 w-3.5 object-contain" />
        {short}
      </p>
    )
  }

  return (
    <p
      className={clsx(
        'flex items-center gap-1 whitespace-nowrap text-2xs tabular-nums',
        gained ? 'text-teal' : 'text-red'
      )}
      title={rank.isDemotion ? `Demoted to ${fullLabel}` : undefined}
    >
      <span aria-hidden>{arrow}</span>
      {Math.abs(rank.lpDelta)} LP
      {/* Demotions are understated on purpose: a muted crest marks the drop
          without giving it the prominence a promotion gets. */}
      {rank.isDemotion && crest && (
        <img src={crest} alt="" className="h-3.5 w-3.5 object-contain opacity-40" />
      )}
    </p>
  )
}
