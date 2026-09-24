import type { ReactNode } from 'react'
import { seasonRange, type Account, type RankRange } from '@foxfire/core'
import { ChampionsPage } from '@foxfire/ui'
import { useChampionStats } from '../queries/championStats'

/**
 * One account's champions: how often each is played and how it goes.
 *
 * The queue and the period are the host's to hold — see DashboardScreen for
 * why. A null range means nobody has picked one, and the screen opens on the
 * newest ranked year that actually has games — the same year the profile's top
 * five is taken from, so its "More" lands on the same numbers.
 */
export function ChampionsScreen({
  account,
  queueId,
  onQueueChange,
  range: picked,
  onRangeChange,
  back
}: {
  account: Account
  queueId: number | null
  onQueueChange: (queueId: number | null) => void
  range: RankRange | null
  onRangeChange: (range: RankRange) => void
  /** The way back to the profile. */
  back?: ReactNode
}): JSX.Element {
  const { periods, range, season, stats, loading } = useChampionStats(account, queueId, picked)

  const rangeOptions: Array<[RankRange, string]> = [
    ...(periods ?? []).map((s): [RankRange, string] => [seasonRange(s.id), s.label]),
    ['all', 'All time']
  ]

  return (
    <ChampionsPage
      stats={stats}
      loading={loading}
      queueId={queueId}
      onQueueChange={onQueueChange}
      range={range}
      rangeOptions={rangeOptions}
      onRangeChange={onRangeChange}
      seasonLabel={season?.label ?? null}
      back={back}
    />
  )
}
