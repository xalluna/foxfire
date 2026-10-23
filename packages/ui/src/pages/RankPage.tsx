import type { ReactNode } from 'react'
import clsx from 'clsx'
import { format } from 'date-fns'
import type { QueueType, RankHistory, RankMilestone, RankRange, RankSnapshot, Season } from '@foxfire/core'
import { LADDERS, laddersOf, parseSeasonRange, rankNetChange, rankRangeCloses, seasonRange } from '@foxfire/core'
import { EmptyState } from '../components/EmptyState'
import { RankChart } from '../components/RankChart'
import { Segmented } from '../components/Segmented'
import { Skeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'
import { queueLabel, ratedTierColor, ratedTierLabel, tierColor, tierCrest, tierLabel } from '../lib/rank'

/** League's two ladders, which is what the page offers unless it is handed a game's own. */
const LEAGUE_LADDERS: Array<[QueueType, string]> = laddersOf('lol').map((ladder) => [
  ladder,
  LADDERS[ladder].shortLabel
])

/** Where a reading stands, as the header says it: a rank and LP, or a colour and a rating. */
function standing(reading: RankSnapshot, rated: boolean): string {
  if (rated) return `${ratedTierLabel(reading.ratedTier)} · ${(reading.ratedRating ?? 0).toLocaleString()} rating`
  return `${tierLabel(reading.tier, reading.rank)} · ${reading.leaguePoints ?? 0} LP`
}

/** What a milestone crossed into, and the colour it is said in. */
function crossedInto(m: RankMilestone, rated: boolean): { label: string; color: string } {
  return rated
    ? { label: ratedTierLabel(m.ratedTier), color: ratedTierColor(m.ratedTier) }
    : { label: tierLabel(m.tier, m.rank), color: tierColor(m.tier) }
}

/**
 * The two relative windows, which exist whether or not anything was recorded.
 * Ranked years are appended between these and All, from what the account
 * actually has.
 */
const RELATIVE_RANGES: Array<[RankRange, string]> = [
  ['7d', '7 days'],
  ['30d', '30 days']
]

/**
 * The climb over time.
 *
 * Starts empty for everyone and fills in from the day rank tracking begins —
 * Riot publishes no historical rank, so there is nothing to backfill and the
 * empty state says so plainly rather than implying data is still loading.
 */
export function RankPage({
  ladders = LEAGUE_LADDERS,
  queueType,
  onQueueTypeChange: setQueueType,
  range,
  onRangeChange: setRange,
  history: data,
  loading: isLoading,
  periods,
  seasons,
  now,
  headerExtra,
  back
}: {
  /** The ladders to pick between, as the picker labels them — one game's. League's by default. */
  ladders?: Array<[QueueType, string]>
  queueType: QueueType
  onQueueTypeChange: (queueType: QueueType) => void
  range: RankRange
  onRangeChange: (range: RankRange) => void
  history: RankHistory | undefined
  loading: boolean
  /** Seasons the account has data in, newest first. */
  periods: Season[] | undefined
  /**
   * Every season, oldest first — what the graph's closes are cut against, so
   * none is carried past a reset. Not `periods`, which stops at the account's
   * newest reading and so misses a reset since somebody last played.
   */
  seasons: Season[] | undefined
  /** When the history was read, which is where the graph's last close is drawn. */
  now: number
  /** Beneath the heading: the desktop says here whether the League client is capturing LP. */
  headerExtra?: ReactNode
  /** Above the heading: the way back to the profile this page hangs off. */
  back?: ReactNode
}): JSX.Element {
  // Hyper Roll climbs a rating rather than divisions: the same page, read in
  // its own unit and coloured by its own tiers.
  const rated = LADDERS[queueType].scale === 'rated'
  const unit = rated ? 'rating' : 'LP'

  const ranges: Array<[RankRange, string]> = [
    ...RELATIVE_RANGES,
    ...(periods ?? []).map((s): [RankRange, string] => [seasonRange(s.id), s.label]),
    ['all', 'All']
  ]

  // Null for the relative windows and for All, which is what separates "the
  // last 30 days happen to be empty" from "this season has nothing in it".
  const selectedSeasonId = parseSeasonRange(range)
  const selected = (periods ?? []).find((s) => s.id === selectedSeasonId) ?? null
  // periods comes back newest first, so anything past the head has ended.
  const pastSeason = selected !== null && (periods ?? [])[0]?.id !== selected.id

  const snapshots = data?.snapshots ?? []
  const milestones = data?.milestones ?? []
  const latest = snapshots[snapshots.length - 1]

  // Counted from the reading before the period, so "30 days" includes the
  // month's first game and says what the profile's card says. Only meaningful
  // inside a single season: across a reset the gap between the two ends is not
  // LP anyone won or lost — it is the reset itself — and reporting it would be
  // the same lie the chart avoids by breaking its line.
  const netLp = rankNetChange(data?.before, snapshots)

  // The graph draws closes — a day's, or six hours' over a week — as the
  // profile's does. The header, the change and the milestones keep reading
  // every reading: each counts games the closes would fold together.
  const closes = data ? rankRangeCloses(data, range, seasons ?? [], now) : null

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 max-md:p-2">
      {back}

      {/* On a phone the pickers drop beneath the heading instead of squeezing it. */}
      <div className="flex items-center justify-between gap-3 max-md:flex-col max-md:items-start">
        <div>
          <h1 className="font-display text-xl text-text">Rank</h1>
          <p className="mt-0.5 text-sm text-text-mute">
            {latest
              ? // "Currently" would be a lie on a year the player has since been
                // reset out of — that reading is where they finished, not where
                // they stand.
                `${pastSeason ? 'Finished' : 'Currently'} ${standing(latest, rated)}`
              : 'No rank recorded yet.'}
          </p>
          {headerExtra}
        </div>

        {/* Wraps because the range picker grows by one button every January. */}
        <div className="flex flex-wrap items-center justify-end gap-2 max-md:justify-start">
          <Segmented options={ladders} value={queueType} onChange={setQueueType} />
          <Segmented options={ranges} value={range} onChange={setRange} />
        </div>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && snapshots.length === 0 && (
        <div className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
          <EmptyState
            icon={<Icon.TrendingUp />}
            title={
              selected === null
                ? 'Rank tracking starts now'
                : `Nothing recorded in ${selected.label}`
            }
            description={
              // Deliberately explicit about the limitation rather than looking
              // like a loading state that never resolves. A named year gets its
              // own wording: the general explanation reads as though the app is
              // broken when the user has simply picked a year it predates.
              selected === null
                ? 'Riot does not publish past rank or per-game LP, so there is nothing to backfill. Play a ranked game with the League client open, or hit Sync, and points will start appearing here.'
                : 'Rank history only covers the time this app has been tracking. Pick a more recent season to see the climb it did record.'
            }
          />
        </div>
      )}

      {!isLoading && closes && snapshots.length > 0 && (
        <>
          <section className="rounded-lg border border-hairline bg-surface/40 p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">
                {queueLabel(queueType)}
              </p>
              {netLp !== null && (
                <p
                  className={clsx(
                    'text-sm tabular-nums',
                    netLp > 0 ? 'text-teal' : netLp < 0 ? 'text-red' : 'text-text-dim'
                  )}
                >
                  {netLp > 0 ? '+' : ''}
                  {netLp} {unit} over this period
                </p>
              )}
            </div>
            <RankChart closes={closes} rated={rated} />
          </section>

          <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
            <p className="border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
              Milestones
            </p>

            {milestones.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-mute">
                No tier or division changes in this period.
              </p>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {milestones.map((m) => {
                  // A rated tier has no crest, so it gets a swatch of its colour.
                  const crest = rated ? null : tierCrest(m.tier)
                  const promoted = m.movement === 'promotion'
                  const into = crossedInto(m, rated)
                  return (
                    <li
                      key={`${m.capturedAt}-${m.tier}-${m.rank}-${m.ratedTier ?? ''}`}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      {crest ? (
                        <img
                          src={crest}
                          alt=""
                          className={clsx('h-7 w-7 object-contain', !promoted && 'opacity-50')}
                        />
                      ) : rated ? (
                        <div className="flex h-7 w-7 items-center justify-center">
                          <span
                            className={clsx('h-3 w-3 rounded-full', !promoted && 'opacity-50')}
                            style={{ backgroundColor: into.color }}
                          />
                        </div>
                      ) : (
                        <div className="h-7 w-7" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm" style={{ color: into.color }}>
                          {promoted ? 'Promoted to' : 'Demoted to'} {into.label}
                        </p>
                      </div>
                      <p className="text-2xs tabular-nums text-text-mute">
                        {format(m.capturedAt, 'MMM d, HH:mm')}
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

