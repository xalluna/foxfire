import { useCallback, type ReactNode } from 'react'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import type { Account, GameId, MatchSummary, RecordingStatus, TftMatchSummary } from '@foxfire/core'
import { paths } from '@foxfire/core/routes'
import { CopyLinkButton, EmptyState, Icon, MatchListSkeleton, RecordingHeader, RecordingPlayer } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useOffersGame } from '../client/useConnection'
import { useShareLink } from '../client/useShareLink'
import { headerFactsFor, isTftRow, tftHeaderFactsFor } from '../match/recordingFacts'
import { queryKeys } from '../queries/keys'

/**
 * One player's recording of one game, from the server, with its markers.
 *
 * What "Watch recording" opens in a browser, and what a desktop opens for a
 * recording it has no file of — somebody else's, or its own after the file was
 * deleted. Always the named account's view: the page asks the server for that
 * account's recording of that game and nothing else, so a link to Ahri's
 * recording never shows Riven's, even of the same game.
 *
 * A match id is unique across games, so the recording itself needs no game.
 * Its row does: `game` says which history to ask first, and the other is asked
 * only when that one has no such game — so a link that left the hint off
 * still finds a TFT game, one request later.
 */
export function RecordingScreen({
  account,
  matchId,
  game = 'lol',
  back,
  actions
}: {
  account: Account
  matchId: string
  /** Which game the link said this was. */
  game?: GameId
  /** The way back, where the host has one to offer. */
  back?: ReactNode
  /** Buttons of the host's own, beside the ones every client has. */
  actions?: ReactNode
}): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const share = useShareLink()

  const readRecording = client.matchRecordings?.get
  const askEmbed = client.matchRecordings?.embed
  const media = platform.media

  // Stable for the player, which asks for a fresh embed each time it mounts the frame.
  const embed = useCallback(() => {
    if (!askEmbed) return Promise.reject(new Error('This app is not connected to a server.'))
    return askEmbed(account.id, matchId)
  }, [askEmbed, account.id, matchId])

  const recording = useQuery({
    queryKey: queryKeys.matchRecording(account.id, matchId),
    queryFn: () => readRecording!(account.id, matchId),
    enabled: readRecording !== undefined,
    // Something on its way is asked about again until it is there, which is
    // also what has the server check on it when no webhook can reach it.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'uploading' || status === 'upload_failed' || status === 'processing' ? 15_000 : false
    }
  })

  // The row, from the history the link named, then from the other. A client
  // that cannot read one League row on its own skips League's.
  const readLeague = client.dashboard.matchSummary
  const rowQuery = (which: GameId, enabled: boolean): UseQueryOptions<MatchSummary | TftMatchSummary | null> =>
    which === 'tft'
      ? {
          queryKey: queryKeys.tftMatchSummary(account.id, matchId),
          queryFn: () => client.tft.matchSummary(account.id, matchId),
          enabled
        }
      : {
          queryKey: queryKeys.matchSummary(account.id, matchId),
          queryFn: () => readLeague!(account.id, matchId),
          enabled: enabled && readLeague !== undefined
        }

  // TFT's history only where TFT is on offer: a server whose host has not
  // turned it on has no TFT rows, and League's is then the only one to ask.
  const tftOffered = useOffersGame('tft')
  const offered = (which: GameId): boolean => which === 'lol' || tftOffered === true
  const asked: GameId = tftOffered === false ? 'lol' : game
  const otherGame: GameId = asked === 'tft' ? 'lol' : 'tft'

  const named = useQuery(rowQuery(asked, offered(asked)))
  const other = useQuery(rowQuery(otherGame, offered(otherGame) && named.data === null))
  const row = named.data ?? other.data ?? null

  const durationSeconds = recording.data?.durationSeconds ?? null
  const facts =
    row && isTftRow(row) ? tftHeaderFactsFor(row, durationSeconds) : headerFactsFor(row, durationSeconds)
  const rowGame: GameId = row && isTftRow(row) ? 'tft' : asked

  const body = ((): JSX.Element => {
    if (!readRecording) {
      return (
        <EmptyState
          icon={<Icon.Film />}
          title="Recordings live on a server"
          description="Connect to a Foxfire Server to watch the recordings people have uploaded to it."
        />
      )
    }

    if (recording.isPending) {
      return (
        <div className="p-6">
          <MatchListSkeleton rows={2} />
        </div>
      )
    }

    if (recording.isError) {
      return (
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="Could not load this recording"
          description={recording.error instanceof Error ? recording.error.message : undefined}
        />
      )
    }

    if (!recording.data) {
      return (
        <EmptyState
          icon={<Icon.Film />}
          title="No recording of this game"
          description={`${account.gameName} has not uploaded their view of this game to this server.`}
        />
      )
    }

    if (!media) {
      return (
        <EmptyState
          icon={<Icon.Film />}
          title="This app cannot play the server's recordings"
          description="Open this recording in Foxfire, on the desktop or in a browser."
        />
      )
    }

    if (recording.data.status !== 'ready') {
      const failed = recording.data.status === 'failed'
      return (
        <EmptyState
          icon={failed ? <Icon.Warning /> : <Icon.Film />}
          {...(failed ? { tone: 'error' as const } : {})}
          title={notReadyTitle(recording.data.status)}
          description={
            failed
              ? (recording.data.error ?? undefined)
              : 'It plays here as soon as the server has it ready.'
          }
        />
      )
    }

    return <RecordingPlayer source={{ kind: 'media', embed, mount: media }} events={recording.data.events} />
  })()

  const video = recording.data ?? null

  return (
    // Tall enough on a page for the video to be worth watching, and filling a
    // window of its own on the desktop, where the parent is the screen.
    <div className="flex min-h-[calc(100vh-8rem)] flex-1 flex-col bg-canvas text-text">
      {back && <div className="px-4 pb-2 pt-4">{back}</div>}

      <RecordingHeader
        facts={facts}
        status={video?.attachedBy ? `Uploaded by ${video.attachedBy}` : undefined}
        actions={
          <>
            {actions}
            {share && video && (
              <CopyLinkButton onCopy={() => share(paths.recording(account, matchId, { game: rowGame }))} />
            )}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}

function notReadyTitle(status: RecordingStatus): string {
  switch (status) {
    case 'processing':
      return 'This recording is processing'
    case 'failed':
      return 'The server could not process this recording'
    default:
      return 'This recording is still uploading'
  }
}
