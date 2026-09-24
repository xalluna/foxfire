import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_QUEUE_FILTER,
  queueTypeForQueueId,
  soloEntryOf,
  type Account,
  type MatchSummary,
  type QueueType
} from '@foxfire/core'
import { paths } from '@foxfire/core/routes'
import { DashboardPage, type ContextMenuState, type MatchFocus } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useShareLink } from '../client/useShareLink'
import { matchContextItems, withoutServerRecording } from '../match/matchMenu'
import { MatchDetailPanel } from '../match/MatchDetailPanel'
import { useRecordingActions } from '../match/useRecordingActions'
import { useHomeAccount } from '../queries/accounts'
import { useFavorites, useRefreshFavorites, useToggleFavorite } from '../queries/favorites'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems } from '../queries/paging'
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
  const queryClient = useQueryClient()
  const platform = usePlatform()
  const share = useShareLink()

  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(focus?.matchId ?? null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  // Why an action on a row failed. Held here rather than on the row because the
  // answer arrives after the menu has closed — a replay that would not open is
  // about the patch this machine has installed rather than about the match.
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (focus) setExpandedMatchId(focus.matchId)
  }, [focus])

  const recordings = useRecordingActions(account)

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
    getNextPageParam: nextOffset
  })

  const sync = useMutation({
    mutationFn: () => client.sync.start(account.id)
  })

  // The star and the house. Both are this machine's or browser's, never the
  // server's: who you keep in the search box, and which profile opens first.
  const { available: canStar, isFavorite } = useFavorites()
  const toggleFavorite = useToggleFavorite()
  const home = useHomeAccount()
  const setHome = useMutation({
    mutationFn: () => client.accounts.setHome(account.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
  })

  // The freshest copy of this player there is, for a favorite that shows them.
  const seen = useMemo(
    () =>
      dashboard.data
        ? [{ account: dashboard.data.account, soloEntry: soloEntryOf(dashboard.data.leagueEntries) }]
        : undefined,
    [dashboard.data]
  )
  useRefreshFavorites(seen)
  const starred = isFavorite(account.id)

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
    const replayId = match.local?.replayId ?? null

    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: matchContextItems(
        match,
        {
          onCopyId: () => void platform.copyText(match.matchId),
          onOpenDetails: () => setExpandedMatchId(match.matchId),
          onCopyLink: share ? () => void share(paths.match(match.matchId, { player: account })) : undefined,

          onEditLp: platform.openLpEditor
            ? () => {
                if (queueType) platform.openLpEditor?.({ account, queueType, matchId: match.matchId })
              }
            : undefined,

          onClearLp: () => {
            if (queueType) clearLp.mutate({ queueType, matchId: match.matchId })
          },

          // Always this history's player's recording: the row is theirs, so
          // is what it offers to play.
          ...recordings.actionsFor(match),

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
        { isMine: account.isMine, ...recordings.menuContext }
      )
    })
  }

  // A client that cannot play YouTube is not offered the server's recordings.
  const flat = pageItems(matches.data, (match) => match.matchId)
  const rows = platform.youtube ? flat : flat.map(withoutServerRecording)

  return (
    <>
      {recordings.dialogs}
      <DashboardPage
        account={dashboard.data?.account ?? account}
        leagueEntries={dashboard.data?.leagueEntries ?? []}
        syncProgress={progress}
        syncing={syncing}
        onSync={() => sync.mutate()}
        onCopyProfileLink={
          share
            ? () => share(paths.player(account, { queue: queueId === DEFAULT_QUEUE_FILTER ? undefined : queueId }))
            : undefined
        }
        favorite={
          canStar
            ? {
                starred,
                onToggle: () =>
                  void toggleFavorite(
                    {
                      account: dashboard.data?.account ?? account,
                      soloEntry: soloEntryOf(dashboard.data?.leagueEntries ?? [])
                    },
                    starred
                  ).then((refused) => refused && setNotice(refused))
              }
            : undefined
        }
        home={{
          isHome: home.data?.id === account.id,
          onSetHome: () => setHome.mutate(),
          where: platform.kind === 'web' ? 'this browser' : 'this PC'
        }}
        matches={rows}
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
    </>
  )
}
