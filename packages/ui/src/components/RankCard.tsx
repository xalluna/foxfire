import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { LeagueEntry, RankTrend } from '@foxfire/core'
import { queueLabel, rankRecord, tierColor, tierCrest, tierLabel } from '../lib/rank'
import { Asset } from './Asset'
import { Bar } from './Bar'
import { RankTrendChart } from './RankTrendChart'
import { Skeleton } from './Skeleton'
import { TierProgressTrack } from './TierProgressTrack'

/** What turns a rank card into the queue's summary: its month, and the way to the rest. */
export interface RankCardDetail {
  /** The last thirty days, a close a day. Undefined while it loads. */
  trend: RankTrend | undefined
  /** The link to the Rank page, built by whoever has a router. */
  more?: ReactNode
}

/**
 * One ranked queue. Renders in both the ranked and unranked case — an empty
 * queue still gets a card so the rail keeps a stable shape rather than
 * collapsing when someone hasn't played flex.
 *
 * With `detail` it is the queue's summary rather than just its rank: how far
 * through the tier, the month's change, the month drawn, and "More" to the
 * Rank page. The rank itself is Riot's current reading either way; only the
 * month comes from Foxfire's own history.
 */
export function RankCard({
  entry,
  detail
}: {
  entry: LeagueEntry
  detail?: RankCardDetail
}): JSX.Element {
  const { games, winRate } = rankRecord(entry)
  const crest = tierCrest(entry.tier)
  const ranked = entry.tier !== null

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
      <div className="p-3">
        <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">
          {queueLabel(entry.queueType)}
        </p>

        <div className="mt-2 flex items-center gap-3">
          {crest ? (
            <Asset src={crest} className="h-12 w-12" rounded="rounded-none" />
          ) : (
            // A dashed hexagon-ish placeholder keeps unranked visually parallel
            // to a crest without pretending to be one.
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-hairline text-2xs text-text-mute">
              —
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p
              className="truncate font-display text-lg leading-tight"
              style={{ color: tierColor(entry.tier) }}
            >
              {tierLabel(entry.tier, entry.rank)}
            </p>
            {ranked && (
              <p className="text-sm tabular-nums text-text-dim">{entry.leaguePoints} LP</p>
            )}
          </div>

          {/* The record beside the rank rather than beneath it, so the card
              spends its height on the track and the month instead. */}
          {ranked && games > 0 && (
            <div className="min-w-24 shrink-0">
              <div className="flex items-baseline justify-between gap-2 text-2xs tabular-nums">
                <span className="whitespace-nowrap text-text-dim">
                  {entry.wins}W {entry.losses}L
                </span>
                <span className={winRate !== null && winRate >= 50 ? 'text-teal' : 'text-text-dim'}>
                  {winRate}%
                </span>
              </div>
              <Bar fraction={(winRate ?? 0) / 100} tone="winrate" className="mt-1" />
            </div>
          )}
        </div>

        {detail && <TierProgressTrack entry={entry} />}
      </div>

      {detail && <Month trend={detail.trend} />}
      {detail?.more}
    </div>
  )
}

/** The month under a rank card: how much it moved, then how. */
function Month({ trend }: { trend: RankTrend | undefined }): JSX.Element {
  const netLp = trend?.netLp ?? null

  return (
    <div className="border-t border-hairline px-3 pb-2 pt-2.5">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-2xs text-text-mute">Last 30 days</p>
        {/* Left out across a season change, where the gap between the two
            ends is a reset rather than anything anybody won or lost. */}
        {netLp !== null && (
          <p
            className={clsx(
              'text-2xs font-medium tabular-nums',
              netLp > 0 ? 'text-teal' : netLp < 0 ? 'text-red' : 'text-text-dim'
            )}
          >
            {netLp > 0 ? '+' : ''}
            {netLp} LP
          </p>
        )}
      </div>

      {trend === undefined ? (
        <Skeleton className="h-[112px] w-full" />
      ) : trend.points.some((p) => p.ladderPosition !== null) ? (
        <RankTrendChart trend={trend} />
      ) : (
        <p className="py-4 text-center text-2xs text-text-mute">
          Nothing recorded yet — rank is tracked from the first ranked game Foxfire sees.
        </p>
      )}
    </div>
  )
}
