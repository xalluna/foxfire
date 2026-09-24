import { useEffect, type MouseEvent, type ReactNode } from 'react'
import type {
  Account,
  LeagueEntry,
  MatchSummary,
  RankTrend,
  SyncProgressEvent
} from '@foxfire/core'
import { queueFilterLabel } from '@foxfire/core'
import { ChampionsCard, type ChampionsCardProps } from '../components/ChampionsCard'
import { ContextMenu, type ContextMenuState } from '../components/ContextMenu'
import { ProfileHeader } from '../components/ProfileHeader'
import type { FavoriteMark, HomeMark } from '../components/ProfileMarks'
import { ProfileStrip } from '../components/ProfileStrip'
import { RankCard } from '../components/RankCard'
import { MatchListRow } from '../components/MatchListRow'
import { QueueFilter } from '../components/QueueFilter'
import { RecentSummary } from '../components/RecentSummary'
import { EmptyState } from '../components/EmptyState'
import { MatchListSkeleton } from '../components/Skeleton'
import { ShowMoreButton } from '../components/ShowMore'
import { SyncButton } from '../components/SyncButton'
import * as Icon from '../components/icons'
import { emptyEntry } from '../lib/rank'

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
  /** When the server takes a sync of this account again. Null when nothing holds it back. */
  syncCooldownUntil: string | null
  /** Copies a link to this profile. Absent where there is no web client to link into. */
  onCopyProfileLink?: () => Promise<void> | void
  /** The star on the profile. Absent where nobody can be starred. */
  favorite?: FavoriteMark
  /** The house on the profile: whether this is the account that opens first, and making it so. */
  home?: HomeMark

  /** Solo/Duo's last thirty days, for the graph on its card. Undefined while it loads. */
  soloTrend: RankTrend | undefined
  /** The way from that card to the Rank page. */
  rankMore?: ReactNode
  /** The season's most-played champions, and the way to the rest of them. */
  champions: ChampionsCardProps

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
 * Two columns: a fixed rail — who, their rank and their month, their champions
 * — and a fluid match column.
 *
 * At the 1280px default this leaves the match list around 830px — close to
 * op.gg's own 740px column, and wide enough for the row to carry its full stat
 * set without wrapping. The rail is fixed rather than fluid so the row layout
 * only has to hold up across one varying width.
 *
 * The rail's cards each summarise a page of their own and end in the way to
 * it — Solo/Duo to the Rank page, the champions to the Champions page — which
 * is what lets the desktop's title bar stop listing those pages.
 */
export function DashboardPage({
  account,
  leagueEntries,
  syncProgress,
  syncing,
  onSync,
  syncCooldownUntil,
  onCopyProfileLink,
  favorite,
  home,
  soloTrend,
  rankMore,
  champions,
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

  const entry = (queueType: LeagueEntry['queueType']): LeagueEntry =>
    leagueEntries.find((e) => e.queueType === queueType) ?? emptyEntry(queueType)
  const solo = entry('RANKED_SOLO_5x5')
  const flex = entry('RANKED_FLEX_SR')

  const soloCard = <RankCard entry={solo} detail={{ trend: soloTrend, more: rankMore }} />
  const flexCard = <RankCard entry={flex} />
  const championsCard = <ChampionsCard {...champions} />

  return (
    <div className="flex gap-4 p-4 max-md:p-2">
      {/*
        Two columns only above 1280px. Below that the match row would have to
        clip its item slots, so the rail folds away: ProfileStrip says who, and
        the cards move into the main column above the list.

        Not sticky. It was, when it held only the identity and two rank cards;
        with a month's graph and the champions under them it is taller than
        most windows, and a sticky block taller than the window hides its own
        bottom until the list beside it runs out.
      */}
      <aside className="hidden w-stats shrink-0 space-y-3 self-start xl:block">
        <ProfileHeader
          account={account}
          onRefresh={onSync}
          refreshing={syncing}
          cooldownUntil={syncCooldownUntil}
          progress={syncProgress}
          onCopyLink={onCopyProfileLink}
          favorite={favorite}
          home={home}
        />
        {soloCard}
        {flexCard}
        {championsCard}
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
            onRefresh={onSync}
            refreshing={syncing}
            cooldownUntil={syncCooldownUntil}
            progress={syncProgress}
            onCopyLink={onCopyProfileLink}
            favorite={favorite}
            home={home}
          />
        </div>

        {/* The rail's cards, when there is no rail: Solo/Duo and Flex down one
            side and the champions down the other, one above the other on a
            phone. A second copy rather than the same elements moved, because
            which copy shows is a viewport query that CSS answers without a
            render. */}
        <div className="grid items-start gap-3 md:grid-cols-2 xl:hidden">
          <div className="space-y-3">
            {soloCard}
            {flexCard}
          </div>
          {championsCard}
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
                !syncing && (
                  <SyncButton onSync={onSync} syncing={false} cooldownUntil={syncCooldownUntil} />
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

          {hasMoreMatches && <ShowMoreButton onClick={onLoadMoreMatches} loading={loadingMoreMatches} />}
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
