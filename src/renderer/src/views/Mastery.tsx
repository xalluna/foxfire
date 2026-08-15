import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account } from '@shared/types'
import { queueFilterLabel } from '@shared/queues'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'
import { Asset } from '../components/Asset'
import { EmptyState } from '../components/EmptyState'
import { QueueFilter } from '../components/QueueFilter'
import { Skeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'
import { useUiStore } from '../store/uiStore'

type SortKey = 'mastery' | 'games'

/** Rate rather than raw wins, so the comparison holds across unequal game counts. */
function winRateOf(row: { winRate: { games: number; wins: number } }): number {
  return row.winRate.games === 0 ? 0 : row.winRate.wins / row.winRate.games
}

export function Mastery({ account }: { account: Account }): JSX.Element {
  const assets = useAssets()
  // Opens on games played: the point of this screen is which champions you
  // actually play and how they perform, which mastery points only proxy for.
  const [sort, setSort] = useState<SortKey>('games')
  const queueId = useUiStore((s) => s.championQueueFilter)
  const setQueueId = useUiStore((s) => s.setChampionQueueFilter)

  const queryClient = useQueryClient()

  const { data, isLoading, isFetching } = useQuery({
    // The queue belongs in the key, or switching filters would serve the
    // previous queue's cached win rates.
    queryKey: ['mastery', account.id, queueId],
    queryFn: () => window.api.mastery.get(account.id, false, queueId)
  })

  // Refetching the query cannot pull new mastery, because the queryFn asks for
  // the cached copy. Refresh has to go through its own call with refresh=true,
  // which updates SQLite; invalidating afterwards re-reads it for every queue.
  const refresh = useMutation({
    mutationFn: () => window.api.mastery.get(account.id, true, queueId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mastery', account.id] })
  })

  if (isLoading || !assets) {
    return (
      <div className="mx-auto max-w-4xl space-y-1.5 p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (!data) {
    return (
      <EmptyState
        icon={<Icon.Trophy />}
        title="No champion data available"
        description="Champion mastery comes from Riot and needs a valid API key."
      />
    )
  }

  const masteryByChamp = new Map(data.riotMastery.map((m) => [m.championId, m]))

  // Driven by games played, not by the mastery list. Riot's mastery is lifetime
  // and all-queue, so unioning the two filled the table with champions carrying
  // a mastery score and a dash everywhere else — noise on a screen whose point
  // is how the champions you actually play are performing.
  //
  // Mastery is still shown for the champions that survive; it just no longer
  // decides who appears.
  const rows = data.localWinRates
    .map((winRate) => ({
      championId: winRate.championId,
      mastery: masteryByChamp.get(winRate.championId) ?? null,
      winRate
    }))
    // Both orderings tie constantly — a whole tail of champions on one game
    // each, and every champion with no cached mastery sitting at zero — so each
    // falls through to further keys rather than leaving equal rows in whatever
    // order the query happened to return. championId last makes the sort total,
    // so the list can never reshuffle between renders.
    .sort((a, b) => {
      if (sort === 'games') {
        return (
          b.winRate.games - a.winRate.games ||
          winRateOf(b) - winRateOf(a) ||
          a.championId - b.championId
        )
      }
      // Mastery can be missing entirely: a champion played this split may
      // predate the cached list, or Riot may simply not have returned it.
      return (
        (b.mastery?.championPoints ?? 0) - (a.mastery?.championPoints ?? 0) ||
        b.winRate.games - a.winRate.games ||
        winRateOf(b) - winRateOf(a) ||
        a.championId - b.championId
      )
    })
    .slice(0, 50)

  const totalGames = data.localWinRates.reduce((n, w) => n + w.games, 0)
  const maxPoints = Math.max(...rows.map((r) => r.mastery?.championPoints ?? 0), 1)
  const queueName = queueFilterLabel(queueId)

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Champions</h1>
          {/* Says outright that the two halves of this table have different
              scopes — Riot publishes no per-queue mastery, so the column cannot
              follow the filter and it would be misleading to imply it does. */}
          <p className="mt-0.5 text-sm text-text-mute">
            Mastery is lifetime across all queues; win rates from your {totalGames} synced{' '}
            {queueId === null ? '' : `${queueName} `}
            {totalGames === 1 ? 'game' : 'games'}.
          </p>
        </div>
        {/* h-8 on every control: without a shared height these size to their
            own content, and one label long enough to wrap made the whole row
            ragged. whitespace-nowrap stops a wrap from resizing anything. */}
        <div className="flex items-center gap-2">
          <QueueFilter value={queueId} onChange={setQueueId} />
          <div className="flex h-8 overflow-hidden rounded-md border border-hairline text-sm">
            {(
              [
                ['games', 'Games'],
                ['mastery', 'Mastery']
              ] as Array<[SortKey, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSort(key)}
                className={clsx(
                  'whitespace-nowrap px-3 transition',
                  sort === key ? 'bg-gold/10 text-gold' : 'text-text-dim hover:bg-surface'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refresh.mutate()}
            disabled={isFetching || refresh.isPending}
            className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-hairline px-3 text-sm text-text-dim transition hover:border-gold-dim hover:text-gold disabled:opacity-50"
          >
            <Icon.Sync className={refresh.isPending ? 'animate-spin' : undefined} />
            {refresh.isPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
          <span>Champion</span>
          <span className="w-28 text-right">Mastery</span>
          <span className="w-14 text-right">Games</span>
          <span className="w-24 text-right">Win rate</span>
        </div>

        {/* Rendered inside the card rather than replacing the page, so the queue
            filter stays reachable — otherwise picking an empty queue would trap
            you on a screen with no way back.
            Rows come only from games played, so an empty table always means an
            empty queue rather than missing mastery. */}
        {rows.length === 0 && (
          <EmptyState
            icon={<Icon.Trophy />}
            title={queueId === null ? 'No champions yet' : `No ${queueName} games found`}
            description={
              queueId === null
                ? 'Sync your match history to see which champions you play and how they do.'
                : 'Try a different queue, or sync more of your match history.'
            }
          />
        )}

        <ul className="divide-y divide-hairline/60">
          {rows.map((row) => {
            const { games, wins } = row.winRate
            const wr = Math.round((wins / games) * 100)

            return (
              <li
                key={row.championId}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2 transition hover:bg-surface"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Asset
                    src={championIconUrl(assets, row.championId)}
                    className="h-9 w-9"
                    rounded="rounded-full"
                  />
                  <span className="truncate text-base text-text">
                    {championName(assets, row.championId)}
                  </span>
                </div>

                <div className="w-28 text-right">
                  {row.mastery ? (
                    <>
                      <p className="text-sm tabular-nums text-text-dim">
                        {row.mastery.championPoints.toLocaleString()}
                        <span className="ml-1.5 text-2xs text-gold">
                          Lv {row.mastery.championLevel}
                        </span>
                      </p>
                      {/* Relative to this player's best champion, not an absolute scale. */}
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-gold/60"
                          style={{ width: `${(row.mastery.championPoints / maxPoints) * 100}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <span className="text-sm text-text-mute">—</span>
                  )}
                </div>

                <span className="w-14 text-right text-sm tabular-nums text-text-dim">{games}</span>

                <div className="w-24 text-right">
                  <p
                    className={clsx('text-sm tabular-nums', wr >= 50 ? 'text-teal' : 'text-text-dim')}
                  >
                    {wr}%
                  </p>
                  <p className="text-2xs tabular-nums text-text-mute">
                    {wins}W {games - wins}L
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
