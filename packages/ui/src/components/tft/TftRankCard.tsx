import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { LeagueEntry, RankTrend, TftLadderSummary } from '@foxfire/core'
import { LADDERS } from '@foxfire/core'
import { queueLabel, ratedTierColor, ratedTierLabel, tierColor, tierCrest, tierLabel } from '../../lib/rank'
import { formatPercent } from '../../lib/matchStats'
import { Asset } from '../Asset'
import { RankTrendChart } from '../RankTrendChart'
import { Skeleton } from '../Skeleton'
import { placementTone } from '../../lib/tft'

/**
 * How a ladder's games have finished this set: a bar per place, first place
 * first, with games played, the average place and the top-half rate above them.
 *
 * Double Up's four bars are the team's places, which is what its LP moves on;
 * every other ladder's eight are the player's own.
 */
export function PlacementSpread({ summary }: { summary: TftLadderSummary }): JSX.Element {
  const slots = summary.placements.length
  const top = slots / 2
  const most = Math.max(1, ...summary.placements)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-2xs tabular-nums text-text-dim">
        <span>
          <span className="text-text">{summary.games}</span> games
        </span>
        <span>
          Avg <span className="text-text">{summary.averagePlacement?.toFixed(2) ?? '—'}</span>
        </span>
        <span>
          Top {top} <span className="text-text">{formatPercent(summary.topRate)}</span>
        </span>
      </div>

      <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}>
        {summary.placements.map((count, i) => {
          const tone = placementTone(i + 1, top)
          return (
            <div key={i} className="flex flex-col items-center gap-1" title={`#${i + 1}: ${count}`}>
              <div className="flex h-10 w-full items-end">
                <div
                  className={clsx(
                    'w-full rounded-sm',
                    tone === 'first' ? 'bg-gold' : tone === 'top' ? 'bg-teal/70' : 'bg-surface-2'
                  )}
                  style={{ height: `${Math.max(count === 0 ? 0 : 8, (count / most) * 100)}%` }}
                />
              </div>
              <span className="text-2xs tabular-nums text-text-mute">#{i + 1}</span>
              <span className="text-2xs font-medium tabular-nums text-text-dim">{count}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One TFT ladder: where somebody stands, how this set has gone, and — on the
 * card that carries it — the month drawn and the way to the Rank page.
 *
 * Ranked and Double Up stand on League's tiers, crest and LP. Hyper Roll is a
 * coloured tier and a rating, with no crest; its graph is the rating.
 */
export function TftRankCard({
  entry,
  summary,
  trend,
  more
}: {
  entry: LeagueEntry
  summary: TftLadderSummary | undefined
  /** The last thirty days, when this card carries them. Undefined while they load. */
  trend?: RankTrend | undefined | null
  more?: ReactNode
}): JSX.Element {
  const rated = LADDERS[entry.queueType].scale === 'rated'
  const ranked = rated ? entry.ratedRating != null : entry.tier !== null
  const crest = rated ? null : tierCrest(entry.tier)

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
      <div className="p-3">
        <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">{queueLabel(entry.queueType)}</p>

        <div className="mt-2 flex items-center gap-3">
          {crest ? (
            <Asset src={crest} className="h-12 w-12" rounded="rounded-none" />
          ) : rated && ranked ? (
            <div
              className="h-12 w-12 shrink-0 rounded-full border-4"
              style={{ borderColor: ratedTierColor(entry.ratedTier) }}
              aria-hidden
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-hairline text-2xs text-text-mute">
              —
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p
              className="truncate font-display text-lg leading-tight"
              style={{ color: rated ? ratedTierColor(entry.ratedTier) : tierColor(entry.tier) }}
            >
              {rated ? (ranked ? ratedTierLabel(entry.ratedTier) : 'Unrated') : tierLabel(entry.tier, entry.rank)}
            </p>
            {ranked && (
              <p className="text-sm tabular-nums text-text-dim">
                {rated ? `${entry.ratedRating?.toLocaleString()} rating` : `${entry.leaguePoints} LP`}
              </p>
            )}
          </div>
        </div>

        {summary && summary.games > 0 && (
          <div className="mt-3">
            <PlacementSpread summary={summary} />
          </div>
        )}
      </div>

      {trend !== null && trend !== undefined && trend.points.some((p) => p.ladderPosition !== null) && (
        <div className="border-t border-hairline px-3 pb-2 pt-2.5">
          <div className="mb-1 flex items-baseline justify-between">
            <p className="text-2xs text-text-mute">Last 30 days</p>
            {trend.netLp !== null && (
              <p
                className={clsx(
                  'text-2xs font-medium tabular-nums',
                  trend.netLp > 0 ? 'text-teal' : trend.netLp < 0 ? 'text-red' : 'text-text-dim'
                )}
              >
                {trend.netLp > 0 ? '+' : ''}
                {trend.netLp} {rated ? 'rating' : 'LP'}
              </p>
            )}
          </div>
          <RankTrendChart trend={trend} rated={rated} />
        </div>
      )}
      {trend === undefined && (
        <div className="border-t border-hairline px-3 py-2.5">
          <Skeleton className="h-[112px] w-full" />
        </div>
      )}
      {more}
    </div>
  )
}
