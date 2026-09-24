import type { ReactNode } from 'react'
import type { ChampionStats } from '@foxfire/core'
import { queueFilterLabel } from '@foxfire/core'
import { mostPlayed } from '../lib/champions'
import { ChampionRecordRow } from './ChampionRecordRow'
import { Segmented } from './Segmented'
import { Skeleton } from './Skeleton'

type QueueKey = 'all' | 'solo' | 'flex'

const QUEUES: Array<[QueueKey, string]> = [
  ['all', 'All'],
  ['solo', 'Solo'],
  ['flex', 'Flex']
]

const QUEUE_IDS: Record<QueueKey, number | null> = { all: null, solo: 420, flex: 440 }

function keyOf(queueId: number | null): QueueKey {
  return queueId === null ? 'all' : queueId === 440 ? 'flex' : 'solo'
}

/** How many the profile shows; the rest are one "More" away. */
const SHOWN = 5

export interface ChampionsCardProps {
  /** Every champion played in the period, in any order. */
  stats: ChampionStats[] | undefined
  loading: boolean
  /** The season the numbers cover, or null for all time. */
  seasonLabel: string | null
  /** All queues, Ranked Solo/Duo or Ranked Flex — null, 420 or 440. */
  queueId: number | null
  onQueueChange: (queueId: number | null) => void
  /** The link to the full table, built by whoever has a router. */
  more?: ReactNode
}

/**
 * The five champions somebody plays most this season, beneath their rank.
 *
 * The Champions page's first five, in its order and from its numbers — the
 * same query, so "More" opens on exactly this list continued. The season is
 * named in the heading because the recent-form block beside the match list
 * can show the same champion over its last few games with a different record,
 * and the two have to be told apart at a glance.
 */
export function ChampionsCard({
  stats,
  loading,
  seasonLabel,
  queueId,
  onQueueChange,
  more
}: ChampionsCardProps): JSX.Element {
  const rows = stats ? mostPlayed(stats, SHOWN) : []

  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-surface">
      <div className="space-y-2 p-3 pb-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">Champions</p>
          <p className="min-w-0 truncate text-2xs text-text-mute">{seasonLabel ?? 'All time'}</p>
        </div>
        <Segmented
          options={QUEUES}
          value={keyOf(queueId)}
          onChange={(key) => onQueueChange(QUEUE_IDS[key])}
          size="sm"
          stretch
        />
      </div>

      <div className="space-y-2 px-3 pb-3">
        {loading &&
          Array.from({ length: SHOWN }, (_, i) => <Skeleton key={i} className="h-7 w-full" />)}

        {!loading && rows.length === 0 && (
          <p className="py-3 text-center text-sm text-text-mute">
            No {queueId === null ? '' : `${queueFilterLabel(queueId)} `}games
            {seasonLabel === null ? ' yet' : ` in ${seasonLabel}`}.
          </p>
        )}

        {!loading &&
          rows.map((row) => <ChampionRecordRow key={row.championId} champ={row} detail="games" />)}
      </div>

      {more}
    </section>
  )
}
