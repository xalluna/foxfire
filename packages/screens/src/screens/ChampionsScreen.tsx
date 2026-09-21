import { useQuery } from '@tanstack/react-query'
import { parseSeasonRange, seasonRange, type Account, type RankRange } from '@foxfire/core'
import { ChampionsPage } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'

/**
 * One account's champions: how often each is played and how it goes.
 *
 * The queue and the period are the host's to hold — see DashboardScreen for
 * why. A null range means nobody has picked one, and the screen opens on the
 * newest ranked year that actually has games.
 */
export function ChampionsScreen({
  account,
  queueId,
  onQueueChange,
  range: picked,
  onRangeChange
}: {
  account: Account
  queueId: number | null
  onQueueChange: (queueId: number | null) => void
  range: RankRange | null
  onRangeChange: (range: RankRange) => void
}): JSX.Element {
  const client = useClient()

  const { data: periods } = useQuery({
    queryKey: queryKeys.rankPeriods(account.id),
    queryFn: () => client.rank.periods(account.id)
  })

  // Null until the user picks one, so the default can follow the newest ranked
  // year that actually has games. That is not always the calendar year — in
  // January, before the first game of the new one, last year is the only thing
  // worth opening on — and it is not known until the periods query lands.
  const range: RankRange =
    picked ?? (periods?.[0] !== undefined ? seasonRange(periods[0].id) : 'all')
  const selectedSeason = (periods ?? []).find((s) => s.id === parseSeasonRange(range)) ?? null

  const rangeOptions: Array<[RankRange, string]> = [
    ...(periods ?? []).map((s): [RankRange, string] => [seasonRange(s.id), s.label]),
    ['all', 'All time']
  ]

  const stats = useQuery({
    // Both the queue and the period belong in the key, or switching either
    // would serve the previous selection's cached stats.
    queryKey: queryKeys.championStats(account.id, queueId, range),
    queryFn: () => client.champions.stats(account.id, queueId, range),
    // Held until the periods land, so the table never flashes a blended
    // all-time number on its way to the year the user is going to see.
    enabled: periods !== undefined
  })

  return (
    <ChampionsPage
      stats={stats.data}
      loading={periods === undefined || stats.isLoading}
      queueId={queueId}
      onQueueChange={onQueueChange}
      range={range}
      rangeOptions={rangeOptions}
      onRangeChange={onRangeChange}
      seasonLabel={selectedSeason?.label ?? null}
    />
  )
}
