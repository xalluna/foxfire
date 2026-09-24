import { useEffect, type MouseEvent, type ReactNode } from 'react'
import type { Account, LeagueEntry, MatchSummary, SyncProgressEvent } from '@foxfire/core'
import { queueFilterLabel } from '@foxfire/core'
import { ContextMenu, type ContextMenuState } from '../components/ContextMenu'
import { ProfileHeader } from '../components/ProfileHeader'
import type { FavoriteMark, HomeMark } from '../components/ProfileMarks'
import { ProfileStrip } from '../components/ProfileStrip'
import { MatchListRow } from '../components/MatchListRow'
import { QueueFilter } from '../components/QueueFilter'
import { RecentSummary } from '../components/RecentSummary'
import { EmptyState } from '../components/EmptyState'
import { MatchListSkeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'

/** A request to show one game, from somewhere other than its row. */
export interface MatchFocus {
  matchId: string
}

export interface DashboardPageProps {
  account: Account
  leagueEntries: LeagueEntry[]
  /** The latest sync event for this account, if one is running or has just failed. */
  syncProgress?: SyncProgressEvent
  syncing: boolean
  onSync: () => void
  /** Copies a link to this profile. Absent where there is no web client to link into. */
  onCopyProfileLink?: () => Promise<void> | void
  /** The star on the profile. Absent where nobody can be starred. */
  favorite?: FavoriteMark
  /** The house on the profile: whether this is the account that opens first, and making it so. */
  home?: HomeMark

  matches: MatchSummary[]
  matchesLoading: boolean
  hasMoreMatches: boolean
  loadingMoreMatches: boolean
  onLoadMoreMatches: () => void

  queueId: number | null
  onQueueChange: (queueId: number | null) => void

  expandedMatchId: string | null
  onToggleMatch: (matchId: string) => void
  /**
   * Scrolled into view whenever it changes — for a match somebody asked to see
   * from elsewhere, which may be several pages down a list that loaded twenty.
   * A fresh object each time it is asked for, so asking twice scrolls twice.
   */
  reveal?: MatchFocus | null
  /** The expanded scoreboard, fetched by whoever knows how. */
  renderMatchDetail: (match: MatchSummary) => ReactNode

  onMatchContextMenu: (event: MouseEvent, match: MatchSummary) => void
  menu: ContextMenuState | null
  onCloseMenu: () => void

  /** Something that went wrong after the menu closed — a replay that would not open, say. */
  notice: string | null
  onDismissNotice: () => void
}

/**
 * Two columns: a fixed identity rail and a fluid match column.
 *
 * At the 1280px default this leaves the match list around 830px — close to
 * op.gg's own 740px column, and wide enough for the row to carry its full stat
 * set without wrapping. The rail is fixed rather than fluid so the row layout
 * only has to hold up across one varying width.
 */
export function DashboardPage({
  account,
  leagueEntries,
  syncProgress,
  syncing,
  onSync,
  onCopyProfileLink,
  favorite,
  home,
  matches: rows,
  matchesLoading,
  hasMoreMatches,
  loadingMoreMatches,
  onLoadMoreMatches,
  queueId,
  onQueueChange,
  expandedMatchId,
  onToggleMatch,
  reveal,
  renderMatchDetail,
  onMatchContextMenu,
  menu,
  onCloseMenu,
  notice,
  onDismissNotice
}: DashboardPageProps): JSX.Element {
  useEffect(() => {
    if (!reveal) return
    const revealMatchId = reveal.matchId
    // The row may be several pages down a list that only loaded twenty.
    // Scrolling to it is best-effort; expanding it is the part that matters.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-match-id="${CSS.escape(revealMatchId)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [reveal])

  return (
    <div className="flex gap-4 p-4 max-md:p-2">
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
          account={account}
          leagueEntries={leagueEntries}
          onRefresh={onSync}
          refreshing={syncing}
          progress={syncProgress}
          onCopyLink={onCopyProfileLink}
          favorite={favorite}
          home={home}
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
            account={account}
            leagueEntries={leagueEntries}
            onRefresh={onSync}
            refreshing={syncing}
            progress={syncProgress}
            onCopyLink={onCopyProfileLink}
            favorite={favorite}
            home={home}
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
            <QueueFilter value={queueId} onChange={onQueueChange} />
          </div>

          {matchesLoading && <MatchListSkeleton />}

          {rows.length === 0 && !matchesLoading && (
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
                !syncing && account.isMine !== false && (
                  <button
                    onClick={onSync}
                    className="flex items-center gap-1.5 rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20"
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
              <li key={match.matchId} data-match-id={match.matchId}>
                <MatchListRow
                  match={match}
                  expanded={expandedMatchId === match.matchId}
                  onToggle={() => onToggleMatch(match.matchId)}
                  onContextMenu={(event) => onMatchContextMenu(event, match)}
                />
                {expandedMatchId === match.matchId && renderMatchDetail(match)}
              </li>
            ))}
          </ul>

          {hasMoreMatches && (
            <button
              onClick={onLoadMoreMatches}
              disabled={loadingMoreMatches}
              className="w-full border-t border-hairline py-2.5 text-sm text-text-dim transition hover:bg-surface hover:text-accent disabled:opacity-50"
            >
              {loadingMoreMatches ? 'Loading…' : 'Show more'}
            </button>
          )}
        </section>
      </div>

      {notice !== null && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber/30 bg-surface px-4 py-3 shadow-flyout">
          <p className="max-w-md text-2xs leading-relaxed text-amber">{notice}</p>
          <button
            type="button"
            onClick={onDismissNotice}
            className="mt-2 text-2xs text-text-mute underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <ContextMenu state={menu} onClose={onCloseMenu} />
    </div>
  )
}
