import { useQuery } from '@tanstack/react-query'
import type { Account, QueueType, RankRange } from '@foxfire/core'
import { RankPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { queryKeys } from '../queries/keys'

/**
 * The climb over time, for one account and one ladder.
 *
 * Which ladder and which window are the host's to hold, so a link can carry
 * them. Anything the platform wants beneath the heading — the desktop's League
 * client status — arrives as a slot.
 */
export function RankScreen({
  account,
  queueType,
  onQueueTypeChange,
  range,
  onRangeChange
}: {
  account: Account
  queueType: QueueType
  onQueueTypeChange: (queueType: QueueType) => void
  range: RankRange
  onRangeChange: (range: RankRange) => void
}): JSX.Element {
  const client = useClient()
  const HeaderExtra = usePlatform().slots?.rankHeaderExtra

  const history = useQuery({
    queryKey: queryKeys.rankHistory(account.id, queueType, range),
    queryFn: () => client.rank.history(account.id, queueType, range)
  })

  const periods = useQuery({
    queryKey: queryKeys.rankPeriods(account.id),
    queryFn: () => client.rank.periods(account.id)
  })

  return (
    <RankPage
      queueType={queueType}
      onQueueTypeChange={onQueueTypeChange}
      range={range}
      onRangeChange={onRangeChange}
      history={history.data}
      loading={history.isLoading}
      periods={periods.data}
      headerExtra={HeaderExtra ? <HeaderExtra account={account} /> : undefined}
    />
  )
}
