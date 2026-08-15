import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { Account } from '@shared/types'
import { queueFilterLabel } from '@shared/queues'
import { ProfileHeader } from '../components/ProfileHeader'
import { ProfileStrip } from '../components/ProfileStrip'
import { MatchListRow } from '../components/MatchListRow'
import { MatchDetailPanel } from '../components/MatchDetailPanel'
import { QueueFilter } from '../components/QueueFilter'
import { RecentSummary } from '../components/RecentSummary'
import { EmptyState } from '../components/EmptyState'
import { MatchListSkeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'
import { useUiStore } from '../store/uiStore'

const PAGE_SIZE = 20

/**
 * Two columns: a fixed identity rail and a fluid match column.
 *
 * At the 1280px default this leaves the match list around 830px — close to
 * op.gg's own 740px column, and wide enough for the row to carry its full stat
 * set without wrapping. The rail is fixed rather than fluid so the row layout
 * only has to hold up across one varying width.
 */
export function Dashboard({ account }: { account: Account }): JSX.Element {
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null)
  const queueId = useUiStore((s) => s.matchQueueFilter)
  const setQueueId = useUiStore((s) => s.setMatchQueueFilter)

  const progress = useUiStore((s) => s.syncProgress[account.id])
  const syncing =
    progress !== undefined && progress.phase !== 'complete' && progress.phase !== 'error'

  const dashboard = useQuery({
    queryKey: ['dashboard', account.id],
    queryFn: () => window.api.dashboard.get(account.id)
  })

  // Genuinely paged: each "Show more" fetches only the next window and appends
  // it. The previous version grew a limit and refetched the whole list from
  // offset 0, which re-queried every row already on screen.
  const matches = useInfiniteQuery({
    queryKey: ['matchList', account.id, queueId],
    queryFn: ({ pageParam }) =>
      window.api.dashboard.matchList(account.id, PAGE_SIZE, pageParam, queueId),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE
        ? undefined
        : allPages.reduce((count, page) => count + page.length, 0)
  })

  const rows = matches.data?.pages.flat() ?? []

  const sync = useMutation({
    mutationFn: () => window.api.sync.start(account.id)
  })

  return (
    <div className="flex gap-4 p-4">
      {/*
        Two columns only above 1280px. Below that the match row would have to
        clip its item slots, so the rail folds into ProfileStrip instead and
        the list takes the full width. Sticky so rank stays on screen while a
        long match list scrolls past it.
      */}
      {/*
        top-4 matches the container's p-4 so the rail is already at its stuck
        offset on load and never jumps when scrolling begins. With top-0 it
        shifts up by the padding the moment the list moves.
      */}
      <aside className="hidden w-stats shrink-0 self-start xl:sticky xl:top-4 xl:block">
        <ProfileHeader
          account={dashboard.data?.account ?? account}
          leagueEntries={dashboard.data?.leagueEntries ?? []}
          onRefresh={() => sync.mutate()}
          refreshing={syncing}
        />
      </aside>

      {/*
        flex+gap rather than space-y: space-y spaces DOM siblings via `* + *`,
        which still counts the display:none ProfileStrip below. That gave the
        right column a leading margin the left column never had, offsetting the
        two columns by exactly the gap. Flex gap ignores hidden children.
      */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="xl:hidden">
          <ProfileStrip
            account={dashboard.data?.account ?? account}
            leagueEntries={dashboard.data?.leagueEntries ?? []}
            onRefresh={() => sync.mutate()}
            refreshing={syncing}
          />
        </div>

        {/* Derived from the same rows the list renders, so it re-aggregates to
            the selected queue with no extra work. */}
        <RecentSummary matches={rows} />

        <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
            <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">
              Match history
            </p>
            <QueueFilter value={queueId} onChange={setQueueId} />
          </div>

          {matches.isLoading && <MatchListSkeleton />}

          {rows.length === 0 && !matches.isLoading && (
            <EmptyState
              icon={<Icon.Inbox />}
              // Never silently widens to all queues on an empty result: a
              // filter that quietly stops meaning what it says is the confusion
              // this whole feature exists to remove.
              title={queueId === null ? 'No matches synced yet' : `No ${queueFilterLabel(queueId)} games found`}
              description={
                queueId !== null
                  ? 'Try a different queue, or sync more of your match history.'
                  : syncing
                    ? 'Sync is running — matches will appear here as they arrive.'
                    : 'Pull your match history from Riot to see it here.'
              }
              action={
                !syncing && (
                  <button
                    onClick={() => sync.mutate()}
                    className="flex items-center gap-1.5 rounded-md border border-gold-dim bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition hover:bg-gold/20"
                  >
                    <Icon.Sync />
                    Sync now
                  </button>
                )
              }
            />
          )}

          <ul className="divide-y divide-hairline/60">
            {rows.map((match) => (
              <li key={match.matchId}>
                <MatchListRow
                  match={match}
                  expanded={expandedMatchId === match.matchId}
                  onToggle={() =>
                    setExpandedMatchId(expandedMatchId === match.matchId ? null : match.matchId)
                  }
                />
                {expandedMatchId === match.matchId && (
                  <MatchDetailPanel matchId={match.matchId} trackedPuuid={account.puuid} />
                )}
              </li>
            ))}
          </ul>

          {matches.hasNextPage && (
            <button
              onClick={() => matches.fetchNextPage()}
              disabled={matches.isFetchingNextPage}
              className="w-full border-t border-hairline py-2.5 text-sm text-text-dim transition hover:bg-surface hover:text-gold disabled:opacity-50"
            >
              {matches.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
