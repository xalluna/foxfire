import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { format } from 'date-fns'
import type { Account, QueueType, RankRange } from '@shared/types'
import { EmptyState } from '../components/EmptyState'
import { LcuIndicator } from '../components/LcuIndicator'
import { RankChart } from '../components/RankChart'
import { Skeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'
import { queueLabel, tierColor, tierCrest, tierLabel } from '../lib/rank'

const QUEUES: Array<[QueueType, string]> = [
  ['RANKED_SOLO_5x5', 'Solo/Duo'],
  ['RANKED_FLEX_SR', 'Flex']
]

const RANGES: Array<[RankRange, string]> = [
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['all', 'All']
]

/**
 * The climb over time.
 *
 * Starts empty for everyone and fills in from the day rank tracking begins —
 * Riot publishes no historical rank, so there is nothing to backfill and the
 * empty state says so plainly rather than implying data is still loading.
 */
export function RankHistory({ account }: { account: Account }): JSX.Element {
  const [queueType, setQueueType] = useState<QueueType>('RANKED_SOLO_5x5')
  const [range, setRange] = useState<RankRange>('30d')

  const { data, isLoading } = useQuery({
    queryKey: ['rankHistory', account.id, queueType, range],
    queryFn: () => window.api.rank.history(account.id, queueType, range)
  })

  const snapshots = data?.snapshots ?? []
  const milestones = data?.milestones ?? []
  const latest = snapshots[snapshots.length - 1]
  const first = snapshots[0]

  const netLp =
    first && latest && first.ladderPosition !== null && latest.ladderPosition !== null
      ? latest.ladderPosition - first.ladderPosition
      : null

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Rank</h1>
          <p className="mt-0.5 text-sm text-text-mute">
            {latest
              ? `Currently ${tierLabel(latest.tier, latest.rank)} · ${latest.leaguePoints ?? 0} LP`
              : 'No rank recorded yet.'}
          </p>
          <LcuIndicator />
        </div>

        <div className="flex items-center gap-2">
          <Segmented options={QUEUES} value={queueType} onChange={setQueueType} />
          <Segmented options={RANGES} value={range} onChange={setRange} />
        </div>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && snapshots.length === 0 && (
        <div className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
          <EmptyState
            icon={<Icon.TrendingUp />}
            title="Rank tracking starts now"
            description={
              // Deliberately explicit about the limitation rather than looking
              // like a loading state that never resolves.
              'Riot does not publish past rank or per-game LP, so there is nothing to backfill. Play a ranked game with the League client open, or hit Sync, and points will start appearing here.'
            }
          />
        </div>
      )}

      {!isLoading && snapshots.length > 0 && (
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
                  {netLp} LP over this period
                </p>
              )}
            </div>
            <RankChart snapshots={snapshots} />
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
                  const crest = tierCrest(m.tier)
                  const promoted = m.movement === 'promotion'
                  return (
                    <li
                      key={`${m.capturedAt}-${m.tier}-${m.rank}`}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      {crest ? (
                        <img
                          src={crest}
                          alt=""
                          className={clsx('h-7 w-7 object-contain', !promoted && 'opacity-50')}
                        />
                      ) : (
                        <div className="h-7 w-7" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm" style={{ color: tierColor(m.tier) }}>
                          {promoted ? 'Promoted to' : 'Demoted to'} {tierLabel(m.tier, m.rank)}
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

/** The app's segmented-toggle idiom, shared by the queue and range pickers. */
function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<[T, string]>
  value: T
  onChange: (value: T) => void
}): JSX.Element {
  return (
    <div className="flex h-8 overflow-hidden rounded-md border border-hairline text-sm">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={clsx(
            'whitespace-nowrap px-3 transition',
            value === key ? 'bg-gold/10 text-gold' : 'text-text-dim hover:bg-surface'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
