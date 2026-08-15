import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Account } from '@shared/types'
import { ProfileHeader } from '../components/ProfileHeader'
import { ProfileStrip } from '../components/ProfileStrip'
import { MatchListRow } from '../components/MatchListRow'
import { MatchDetailPanel } from '../components/MatchDetailPanel'
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
  const [limit, setLimit] = useState(PAGE_SIZE)

  const progress = useUiStore((s) => s.syncProgress[account.id])
  const syncing =
    progress !== undefined && progress.phase !== 'complete' && progress.phase !== 'error'

  const dashboard = useQuery({
    queryKey: ['dashboard', account.id],
    queryFn: () => window.api.dashboard.get(account.id)
  })

  const matches = useQuery({
    queryKey: ['matchList', account.id, limit],
    queryFn: () => window.api.dashboard.matchList(account.id, limit, 0)
  })

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

        <RecentSummary matches={matches.data} />

        <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
          <p className="border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
            Match history
          </p>

          {matches.isLoading && <MatchListSkeleton />}

          {matches.data?.length === 0 && !matches.isLoading && (
            <EmptyState
              icon={<Icon.Inbox />}
              title="No matches synced yet"
              description={
                syncing
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
            {matches.data?.map((match) => (
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

          {matches.data && matches.data.length >= limit && (
            <button
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
              className="w-full border-t border-hairline py-2.5 text-sm text-text-dim transition hover:bg-surface hover:text-gold"
            >
              Show more
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
