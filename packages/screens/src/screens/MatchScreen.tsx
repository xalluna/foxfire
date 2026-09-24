import { useQuery } from '@tanstack/react-query'
import { parsePlayerSlug, paths } from '@foxfire/core/routes'
import { CopyLinkButton, Icon, MatchPage, recordingActionClass } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useShareLink } from '../client/useShareLink'
import { recordingBlockedReason, withoutServerRecording } from '../match/matchMenu'
import { useAccountByRiotId } from '../queries/accounts'
import { queryKeys } from '../queries/keys'
import { PlayerBackLink } from '../routes/PlayerBackLink'

/** Whether a failed read was the server saying it has no such thing. */
function isNotFound(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404
}

/**
 * One game, on a page of its own: what a link to it opens on.
 *
 * The link names the game and, usually, whose game it was. When that player
 * is on this server the page shows it as they saw it — their row from the
 * history, LP included, and their line picked out of the scoreboard — with the
 * way back to their profile. When the link names nobody this server knows, it
 * is still the game, just nobody's in particular.
 */
export function MatchScreen({ matchId, player }: { matchId: string; player?: string }): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const share = useShareLink()

  const riotId = player === undefined ? null : parsePlayerSlug(player)
  const account = useAccountByRiotId(riotId).data ?? null
  const readSummary = client.dashboard.matchSummary

  const summary = useQuery({
    queryKey: queryKeys.matchSummary(account?.id ?? '', matchId),
    queryFn: () => readSummary!(account!.id, matchId),
    enabled: account !== null && readSummary !== undefined
  })

  const detail = useQuery({
    queryKey: queryKeys.matchDetail(matchId),
    queryFn: () => client.dashboard.matchDetail(matchId),
    // A game the server has no record of is an answer, not a failure to retry.
    retry: (count, error) => !isNotFound(error) && count < 1
  })

  // As on the history: no server recording where nothing here can play it.
  const row = summary.data && !platform.youtube ? withoutServerRecording(summary.data) : summary.data

  const notFound = (detail.isSuccess && detail.data === null) || (detail.isError && isNotFound(detail.error))

  return (
    <MatchPage
      back={account && <PlayerBackLink account={account} label="profile" />}
      actions={
        <>
          {/* Only when the link named a player, and only theirs: with nobody
              named there is no one whose screen to show. */}
          {account && row && platform.watchRecording && recordingBlockedReason(row) === null && (
            <button
              type="button"
              className={`${recordingActionClass} inline-flex items-center gap-1.5`}
              onClick={() => platform.watchRecording?.({ account, match: row })}
            >
              <Icon.Film width={13} height={13} />
              Watch {account.gameName}&rsquo;s recording
            </button>
          )}
          {share && (
            <CopyLinkButton onCopy={() => share(paths.match(matchId, account ? { player: account } : {}))} />
          )}
        </>
      }
      summary={row}
      summaryLoading={account !== null && readSummary !== undefined && summary.isLoading}
      detail={detail.data}
      detailLoading={detail.isLoading}
      trackedPuuid={account?.puuid ?? null}
      notFound={notFound}
    />
  )
}
