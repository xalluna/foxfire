import { useEffect, type MouseEvent, type ReactNode } from 'react'
import type {
  Account,
  LeagueEntry,
  RankTrend,
  SyncProgressEvent,
  TftAccess,
  TftLadder,
  TftLadderSummary,
  TftMatchSummary
} from '@foxfire/core'
import { laddersOf, queueFilterLabel, queueFilterOptions } from '@foxfire/core'
import { ContextMenu, type ContextMenuState } from '../components/ContextMenu'
import { ProfileHeader } from '../components/ProfileHeader'
import type { FavoriteMark, HomeMark } from '../components/ProfileMarks'
import { ProfileStrip } from '../components/ProfileStrip'
import { QueueFilter } from '../components/QueueFilter'
import { EmptyState } from '../components/EmptyState'
import { MatchListSkeleton } from '../components/Skeleton'
import { ShowMoreButton } from '../components/ShowMore'
import { SyncButton } from '../components/SyncButton'
import { TftMatchListRow } from '../components/tft/TftMatchListRow'
import { TftRankCard } from '../components/tft/TftRankCard'
import { TftRecentSummary } from '../components/tft/TftRecentSummary'
import * as Icon from '../components/icons'
import { emptyEntry } from '../lib/rank'
import type { MatchFocus } from './DashboardPage'

export interface TftProfilePageProps {
  account: Account
  /** TFT's entries; a ladder with none still gets a card. */
  leagueEntries: LeagueEntry[]
  /** Each ladder's placements this set, from the dashboard. Undefined while it loads. */
  ladders: TftLadderSummary[] | undefined
  /** The current set's name, for the cards' heading. */
  seasonLabel: string | null
  /** Whether this server's key reaches TFT at all. */
  tftAccess: TftAccess
  syncProgress?: SyncProgressEvent
  syncing: boolean
  onSync: () => void
  syncCooldownUntil: string | null
  onCopyProfileLink?: () => Promise<void> | void
  favorite?: FavoriteMark
  home?: HomeMark

  /** Ranked's last thirty days, for the graph on its card. Undefined while it loads. */
  rankedTrend: RankTrend | undefined
  /** The way from a ladder's card to the TFT Rank page, open on that ladder. */
  rankMore?: (ladder: TftLadder) => ReactNode

  matches: TftMatchSummary[]
  matchesLoading: boolean
  hasMoreMatches: boolean
  loadingMoreMatches: boolean
  onLoadMoreMatches: () => void

  queueId: number | null
  onQueueChange: (queueId: number | null) => void

  expandedMatchId: string | null
  onToggleMatch: (matchId: string) => void
  reveal?: MatchFocus | null
  /** The expanded lobby, fetched by whoever knows how. */
  renderMatchDetail: (match: TftMatchSummary) => ReactNode

  onMatchContextMenu: (event: MouseEvent, match: TftMatchSummary) => void
  menu: ContextMenuState | null
  onCloseMenu: () => void

  notice: string | null
  onDismissNotice: () => void
}

/**
 * A player's TFT, laid out as their League profile is: who they are and a card
 * per ladder down the rail — Ranked with its month and the way to the Rank
 * page, then Double Up and Hyper Roll — and the history beside it, under the
 * recent stretch.
 *
 * The same Riot ID as the League page it sits beside; the switch above both is
 * what moves between them.
 */
export function TftProfilePage({
  account,
  leagueEntries,
  ladders,
  seasonLabel,
  tftAccess,
  syncProgress,
  syncing,
  onSync,
  syncCooldownUntil,
  onCopyProfileLink,
  favorite,
  home,
  rankedTrend,
  rankMore,
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
}: TftProfilePageProps): JSX.Element {
  useEffect(() => {
    if (!reveal) return
    const revealMatchId = reveal.matchId
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-match-id="${CSS.escape(revealMatchId)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [reveal])

  const cards = (laddersOf('tft') as TftLadder[]).map((ladder) => (
    <TftRankCard
      key={ladder}
      entry={leagueEntries.find((e) => e.queueType === ladder) ?? emptyEntry(ladder)}
      summary={ladders?.find((l) => l.queueType === ladder)}
      trend={ladder === 'RANKED_TFT' ? rankedTrend : null}
      more={rankMore?.(ladder)}
    />
  ))

  const denied = tftAccess === 'denied' && (
    <div className="rounded-lg border border-amber/30 bg-amber/[0.06] px-4 py-3 text-xs leading-relaxed text-amber">
      This server&apos;s Riot key cannot reach TFT, so nothing new is fetched for it. Whatever was stored before still
      shows. Its host can add a TFT key.
    </div>
  )

  return (
    <div className="flex gap-4 p-4 max-md:p-2">
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
        {seasonLabel && (
          <p className="px-1 text-2xs font-medium uppercase tracking-widest text-text-mute">{seasonLabel}</p>
        )}
        {cards}
      </aside>

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

        {denied}

        <div className="grid items-start gap-3 md:grid-cols-2 xl:hidden">{cards}</div>

        <TftRecentSummary matches={rows} />

        <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
            <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">Match history</p>
            <QueueFilter value={queueId} onChange={onQueueChange} options={queueFilterOptions('tft')} />
          </div>

          {matchesLoading && <MatchListSkeleton />}

          {rows.length === 0 && !matchesLoading && (
            <EmptyState
              icon={<Icon.Inbox />}
              title={queueId === null ? 'No TFT games synced yet' : `No ${queueFilterLabel(queueId)} games found`}
              description={
                queueId !== null
                  ? 'Try a different queue, or sync more of this history.'
                  : syncing
                    ? 'Sync is running — games will appear here as they arrive.'
                    : 'Pull this TFT history from Riot to see it here.'
              }
              action={!syncing && <SyncButton onSync={onSync} syncing={false} cooldownUntil={syncCooldownUntil} />}
            />
          )}

          <ul className="divide-y divide-hairline/60">
            {rows.map((match) => (
              <li key={match.matchId} data-match-id={match.matchId}>
                <TftMatchListRow
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
          <p className="max-w-md text-xs leading-relaxed text-amber">{notice}</p>
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
