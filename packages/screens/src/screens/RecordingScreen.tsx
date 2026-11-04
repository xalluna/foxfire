import type { ReactNode } from 'react'
import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import type { Account, GameId, MatchSummary, TftMatchSummary } from '@foxfire/core'
import { paths } from '@foxfire/core/routes'
import { youtubeWatchUrl } from '@foxfire/core/youtube'
import {
  CopyLinkButton,
  EmptyState,
  Icon,
  MatchListSkeleton,
  RecordingHeader,
  RecordingPlayer,
  recordingActionClass
} from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useShareLink } from '../client/useShareLink'
import { headerFactsFor, isTftRow, tftHeaderFactsFor } from '../match/recordingFacts'
import { queryKeys } from '../queries/keys'

/**
 * One player's recording of one game, from YouTube, with its markers.
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

  const recording = useQuery({
    queryKey: queryKeys.matchRecording(account.id, matchId),
    queryFn: () => readRecording!(account.id, matchId),
    enabled: readRecording !== undefined
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

  const named = useQuery(rowQuery(game, true))
  const other = useQuery(rowQuery(game === 'tft' ? 'lol' : 'tft', named.data === null))
  const row = named.data ?? other.data ?? null

  const durationSeconds = recording.data?.durationSeconds ?? null
  const facts =
    row && isTftRow(row) ? tftHeaderFactsFor(row, durationSeconds) : headerFactsFor(row, durationSeconds)
  const rowGame: GameId = row && isTftRow(row) ? 'tft' : game

  const body = ((): JSX.Element => {
    if (!readRecording) {
      return (
        <EmptyState
          icon={<Icon.Film />}
          title="Recordings live on a server"
          description="Connect to a Foxfire Server to watch recordings people have put on YouTube."
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
          description={`${account.gameName} has not put their view of this game on YouTube.`}
        />
      )
    }

    if (!platform.youtube) {
      return (
        <EmptyState
          icon={<Icon.Film />}
          title="This app cannot play YouTube recordings"
          description="Open it on YouTube instead."
        />
      )
    }

    return (
      <RecordingPlayer
        source={{ kind: 'youtube', videoId: recording.data.youtubeVideoId, mount: platform.youtube }}
        events={recording.data.events}
      />
    )
  })()

  const video = recording.data ?? null

  return (
    // Tall enough on a page for the video to be worth watching, and filling a
    // window of its own on the desktop, where the parent is the screen.
    <div className="flex min-h-[calc(100vh-8rem)] flex-1 flex-col bg-canvas text-text">
      {back && <div className="px-4 pb-2 pt-4">{back}</div>}

      <RecordingHeader
        facts={facts}
        status={
          video?.privacy === 'private'
            ? 'Private on YouTube — it only plays for its owner'
            : video?.attachedBy
              ? `Attached by ${video.attachedBy}`
              : undefined
        }
        actions={
          <>
            {actions}
            {video && (
              <a
                href={youtubeWatchUrl(video.youtubeVideoId)}
                target="_blank"
                rel="noopener noreferrer"
                className={`${recordingActionClass} inline-flex items-center gap-1.5`}
              >
                <Icon.ExternalLink width={13} height={13} />
                Open on YouTube
              </a>
            )}
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
