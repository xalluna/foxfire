import type { ReactNode } from 'react'
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
  onRangeChange,
  back
}: {
  account: Account
  queueType: QueueType
  onQueueTypeChange: (queueType: QueueType) => void
  range: RankRange
  onRangeChange: (range: RankRange) => void
  /** The way back to the profile. */
  back?: ReactNode
}): JSX.Element {
  const client = useClient()
  const HeaderExtra = usePlatform().slots?.rankHeaderExtra
  const share = useShareLink()

  // Whole, not paged — the one list that grows which is fetched in one go. The
  // milestones are read off neighbouring readings and the change over the
  // period counts every game, so a page would leave gaps in both; the range
  // bounds it instead, a few hundred for the thirty days the page opens on. The
  // graph thins it to closes itself. See FoxfireData.rank.history.
  const history = useQuery({
    queryKey: queryKeys.rankHistory(account.id, queueType, range),
    queryFn: () => client.rank.history(account.id, queueType, range)
  })

  const periods = useQuery({
    queryKey: queryKeys.rankPeriods(account.id),
    queryFn: () => client.rank.periods(account.id)
  })

  // The whole table, for where the graph's closes stop at a reset.
  const seasons = useQuery({
    queryKey: queryKeys.seasons(),
    queryFn: () => client.seasons.list()
  })

  return (
    <RankPage
      queueType={queueType}
      onQueueTypeChange={onQueueTypeChange}
      range={range}
      onRangeChange={onRangeChange}
      history={history.data}
      loading={history.isLoading || seasons.isLoading}
      periods={periods.data}
      seasons={seasons.data}
      // The moment the readings were read, rather than each render's: the
      // closes are drawn back from it, and would otherwise creep under the
      // pointer.
      now={history.dataUpdatedAt}
      back={back}
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
