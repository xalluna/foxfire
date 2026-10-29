import { useEffect, useState, type MouseEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  queueTypeForQueueId,
  soloEntryOf,
  type Account,
  type DashboardData,
  type QueueType,
  type TftMatchSummary
} from '@foxfire/core'
import { paths, playerSlug } from '@foxfire/core/routes'
import { TftProfilePage, type ContextMenuState, type MatchFocus } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useIsHeadAdmin, useViewer } from '../client/useConnection'
import { useShareLink } from '../client/useShareLink'
import { matchContextItems, withoutServerRecording } from '../match/matchMenu'
import { TftLobbyPanel } from '../match/TftLobbyPanel'
import { useRecordingActions } from '../match/useRecordingActions'
import { useHomeAccount } from '../queries/accounts'
import { useFavorites, useToggleFavorite } from '../queries/favorites'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems } from '../queries/paging'
import { useShareProfile } from '../queries/shareProfile'
import { isSyncing, syncCooldownUntil, useSyncProgress } from '../store/syncProgress'
import { tftRankQueueSearchFor } from '../routes/params'
import { MoreLink } from './MoreLink'

const PAGE_SIZE = 20

const RANKED: QueueType = 'RANKED_TFT'

/**
 * One account's TFT: a card per ladder with its placements this set, the
 * recent stretch, and the history with each game's lobby a click away.
 *
 * The same shape as the League profile it sits beside, and the same things
 * around it — the star, the house, the sync button, copy link — because it is
 * the same player. What differs is what it reads: TFT's dashboard, TFT's
 * history, and TFT's own sync, which runs beside League's rather than with it.
 */
export function TftProfileScreen({
  account,
  queueId,
  onQueueChange,
  focus = null
}: {
  account: Account
  queueId: number | null
  onQueueChange: (queueId: number | null) => void
  focus?: MatchFocus | null
}): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const platform = usePlatform()
  const share = useShareLink()

  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(focus?.matchId ?? null)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (focus) setExpandedMatchId(focus.matchId)
  }, [focus])

  const recordings = useRecordingActions(account, 'tft')
  const isHeadAdmin = useIsHeadAdmin()
  const { outsider, viaLink } = useViewer()
  const shareProfile = useShareProfile(account, (token) => paths.tft(account, { share: token }))

  const progress = useSyncProgress(account.id, 'tft')
  const syncing = isSyncing(progress)

  const dashboard = useQuery({
    queryKey: queryKeys.tftDashboard(account.id),
    queryFn: () => client.tft.dashboard(account.id)
  })

  const rankedTrend = useQuery({
    queryKey: queryKeys.rankTrend(account.id, RANKED),
    queryFn: () => client.tft.rank.trend(account.id, RANKED)
  })

  const matches = useInfiniteQuery({
    queryKey: queryKeys.tftMatchList(account.id, queueId),
    queryFn: ({ pageParam }) => client.tft.matchList(account.id, PAGE_SIZE, pageParam, queueId),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  const cooldownUntil = syncCooldownUntil(dashboard.data?.syncState, progress)
  const sync = useMutation({
    mutationFn: () => client.sync.start(account.id, 'tft'),
    onSuccess: (outcome) => {
      if (!outcome.ok && outcome.error) setNotice(outcome.error)
    }
  })

  const { available: canStar, isFavorite } = useFavorites()
  const toggleFavorite = useToggleFavorite()
  const home = useHomeAccount({ enabled: !viaLink })
  const setHome = useMutation({
    mutationFn: () => client.accounts.setHome(account.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts() })
  })

  // A favorite is the player, and its search row shows their League rank —
  // which this page does not read. So it is starred with League's entry as far
  // as this client already holds it, and not refreshed from here: a refresh
  // with no League entry would wipe the one the favorite has.
  const starred = isFavorite(account.id)
  const leagueEntries = (): DashboardData['leagueEntries'] =>
    queryClient.getQueryData<DashboardData | null>(queryKeys.dashboard(account.id))?.leagueEntries ?? []

  const clearLp = useMutation({
    mutationFn: ({ queueType, matchId }: { queueType: QueueType; matchId: string }) =>
      client.tft.rank.clearManual(account.id, queueType, matchId)
  })

  const openMatchMenu = (event: MouseEvent, match: TftMatchSummary): void => {
    event.preventDefault()
    const queueType = queueTypeForQueueId(match.queueId)

    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: matchContextItems(
        match,
        {
          onCopyId: () => void platform.copyText(match.matchId),
          onOpenDetails: () => setExpandedMatchId(match.matchId),
          onCopyLink: share ? () => void share(paths.tft(account, { match: match.matchId })) : undefined,
          onEditLp: platform.openLpEditor
            ? () => {
                if (queueType) platform.openLpEditor?.({ account, queueType, matchId: match.matchId })
              }
            : undefined,
          onClearLp: () => {
            if (queueType) clearLp.mutate({ queueType, matchId: match.matchId })
          },
          ...recordings.actionsFor(match)
        },
        { isMine: account.isMine, isHeadAdmin, ...recordings.menuContext, outsider }
      )
    })
  }

  const flat = pageItems(matches.data, (match) => match.matchId)
  const rows = platform.youtube ? flat : flat.map(withoutServerRecording)

  return (
    <>
      {recordings.dialogs}
      {shareProfile.dialog}
      <TftProfilePage
        account={dashboard.data?.account ?? account}
        leagueEntries={dashboard.data?.leagueEntries ?? []}
        ladders={dashboard.data?.ladders}
        seasonLabel={dashboard.data?.seasonLabel ?? null}
        tftAccess={dashboard.data?.tftAccess ?? 'unknown'}
        syncProgress={progress}
        syncing={syncing}
        onSync={outsider ? undefined : () => sync.mutate()}
        syncCooldownUntil={cooldownUntil}
        // One or the other, as on League's profile: Share takes Copy link's place.
        onCopyProfileLink={
          share && !shareProfile.onShare
            ? () => share(paths.tft(account, { queue: queueId ?? undefined }))
            : undefined
        }
        onShareProfile={shareProfile.onShare}
        favorite={
          canStar && !viaLink
            ? {
                starred,
                onToggle: () =>
                  void toggleFavorite(
                    { account: dashboard.data?.account ?? account, soloEntry: soloEntryOf(leagueEntries()) },
                    starred
                  ).then((refused) => refused && setNotice(refused))
              }
            : undefined
        }
        home={
          viaLink
            ? undefined
            : {
                isHome: home.data?.id === account.id,
                onSetHome: () => setHome.mutate(),
                where: platform.kind === 'web' ? 'this browser' : 'this PC'
              }
        }
        rankedTrend={rankedTrend.data}
        rankMore={(ladder) => (
          // That card's ladder, and no range: thirty days is where the Rank page opens.
          <MoreLink
            to="/players/$slug/tft/rank"
            slug={playerSlug(account)}
            search={{ queue: tftRankQueueSearchFor(ladder) }}
            label="Rank history"
          />
        )}
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
        renderMatchDetail={(match) => <TftLobbyPanel account={account} matchId={match.matchId} />}
        onMatchContextMenu={openMatchMenu}
        menu={menu}
        onCloseMenu={() => setMenu(null)}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />
    </>
  )
}
