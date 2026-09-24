import { useQuery } from '@tanstack/react-query'
import type { Account, QueueType, RankRange } from '@foxfire/core'
import { paths, rankQueueParam } from '@foxfire/core/routes'
import { CopyLinkButton, RankPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useShareLink } from '../client/useShareLink'
import { queryKeys } from '../queries/keys'

/**
 * The climb over time, for one account and one ladder.
 *
 * Which ladder and which window are the host's to hold, so a link can carry
 * them — and "Copy link" does, so whoever opens it sees the same graph.
 * Anything the platform wants beneath the heading — the desktop's League
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
  const share = useShareLink()

  // Whole, not paged — the one list that grows which is fetched in one go. The
  // graph needs every reading to draw its line, and the range bounds it: a few
  // hundred for the thirty days the page opens on. See FoxfireData.rank.history.
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
      headerExtra={
        HeaderExtra || share ? (
          <div className="flex flex-wrap items-center gap-3">
            {HeaderExtra && <HeaderExtra account={account} />}
            {share && (
              <CopyLinkButton
                onCopy={() => share(paths.rank(account, { queue: rankQueueParam(queueType), range }))}
              />
            )}
          </div>
        ) : undefined
      }
    />
  )
}
