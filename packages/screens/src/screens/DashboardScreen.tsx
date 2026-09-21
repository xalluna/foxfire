import { useEffect, useState, type MouseEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { queueTypeForQueueId, type Account, type MatchSummary, type QueueType } from '@foxfire/core'
import { DashboardPage, type ContextMenuState, type MatchFocus } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { matchContextItems } from '../match/matchMenu'
import { MatchDetailPanel } from '../match/MatchDetailPanel'
import { queryKeys } from '../queries/keys'
import { isSyncing, useSyncProgress } from '../store/syncProgress'

const PAGE_SIZE = 20

/**
 * One account's profile: rank, recent form, and its match history.
 *
 * The queue filter is the host's to hold, because where it lives — a store, a
 * URL — decides whether it survives navigating away and back, and that is a
 * decision about the app rather than about this screen.
 */
export function DashboardScreen({
  account,
  queueId,
  onQueueChange,
  focus = null
}: {
  account: Account
  queueId: number | null
  onQueueChange: (queueId: number | null) => void
  /**
   * A game somebody asked to see from elsewhere — a recording window's "show
   * match". Expanded and scrolled to whenever a new one arrives, so asking for
   * the same game twice still works.
   */
  focus?: MatchFocus | null
}): JSX.Element {
  const client = useClient()
  const platform = usePlatform()

  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(focus?.matchId ?? null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  // Why an action on a row failed. Held here rather than on the row because the
  // answer arrives after the menu has closed — a replay that would not open is
  // about the patch this machine has installed rather than about the match.
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (focus) setExpandedMatchId(focus.matchId)
  }, [focus])

  const progress = useSyncProgress(account.id)
  const syncing = isSyncing(progress)

  const dashboard = useQuery({
    queryKey: queryKeys.dashboard(account.id),
    queryFn: () => client.dashboard.get(account.id)
  })

  // Genuinely paged: each "Show more" fetches only the next window and appends
  // it. The previous version grew a limit and refetched the whole list from
  // offset 0, which re-queried every row already on screen.
  const matches = useInfiniteQuery({
    queryKey: queryKeys.matchList(account.id, queueId),
    queryFn: ({ pageParam }) => client.dashboard.matchList(account.id, PAGE_SIZE, pageParam, queueId),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE
        ? undefined
        : allPages.reduce((count, page) => count + page.length, 0)
  })

  const sync = useMutation({
    mutationFn: () => client.sync.start(account.id)
  })

  // Clearing returns the editor's fresh list, which this screen has no use for
  // — the match row and rank graph refresh off the rank-edited event, the same
  // as an edit made in the editor itself.
  const clearLp = useMutation({
    mutationFn: ({ queueType, matchId }: { queueType: QueueType; matchId: string }) =>
      client.rank.clearManual(account.id, queueType, matchId)
  })

  const openMatchMenu = (event: MouseEvent, match: MatchSummary): void => {
    event.preventDefault()
    const queueType = queueTypeForQueueId(match.queueId)
    const recordingId = match.local?.recordingId ?? null
    const replayId = match.local?.replayId ?? null

    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: matchContextItems(
        match,
        {
          onCopyId: () => void platform.copyText(match.matchId),
          onOpenDetails: () => setExpandedMatchId(match.matchId),

          onEditLp: platform.openLpEditor
            ? () => {
                if (queueType) platform.openLpEditor?.({ account, queueType, matchId: match.matchId })
              }
            : undefined,

          onClearLp: () => {
            if (queueType) clearLp.mutate({ queueType, matchId: match.matchId })
          },

          onWatchRecording: platform.watchRecording
            ? () => {
                if (recordingId !== null) platform.watchRecording?.(recordingId)
              }
            : undefined,

          // Unlike a recording, opening this can fail for a reason the person
          // can act on — no installed client still plays that patch. The menu
          // is gone by then, so the answer is surfaced here.
          onWatchReplay: platform.launchReplay
            ? () => {
                if (replayId === null) return
                void platform.launchReplay?.(replayId).then((outcome) => {
                  if (!outcome.ok && outcome.message) setNotice(outcome.message)
                })
              }
            : undefined,

          // The list refreshes off whatever the download changes, so the row
          // picks up its new state without this having to say anything.
          onDownloadReplay: platform.downloadReplay
            ? () => {
                void platform.downloadReplay?.(match.matchId).then((outcome) => {
                  if (!outcome.ok) {
                    setNotice(outcome.message ?? 'That replay could not be downloaded from the server.')
                  }
                })
              }
            : undefined
        },
        // On a server the history is everybody's and the writes are not, so the
        // menu has to know whose account this is.
        { isMine: account.isMine }
      )
    })
  }

  return (
    <DashboardPage
      account={dashboard.data?.account ?? account}
      leagueEntries={dashboard.data?.leagueEntries ?? []}
      syncProgress={progress}
      syncing={syncing}
      onSync={() => sync.mutate()}
      matches={matches.data?.pages.flat() ?? []}
      matchesLoading={matches.isLoading}
      hasMoreMatches={matches.hasNextPage}
      loadingMoreMatches={matches.isFetchingNextPage}
      onLoadMoreMatches={() => void matches.fetchNextPage()}
      queueId={queueId}
      onQueueChange={onQueueChange}
      expandedMatchId={expandedMatchId}
      onToggleMatch={(matchId) => setExpandedMatchId(expandedMatchId === matchId ? null : matchId)}
      reveal={focus}
      renderMatchDetail={(match) => (
        <MatchDetailPanel matchId={match.matchId} trackedPuuid={account.puuid} />
      )}
      onMatchContextMenu={openMatchMenu}
      menu={menu}
      onCloseMenu={() => setMenu(null)}
      notice={notice}
      onDismissNotice={() => setNotice(null)}
    />
  )
}
