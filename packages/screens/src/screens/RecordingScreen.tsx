import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Account, MatchSummary } from '@foxfire/core'
import { paths } from '@foxfire/core/routes'
import { youtubeWatchUrl } from '@foxfire/core/youtube'
import {
  CopyLinkButton,
  EmptyState,
  Icon,
  MatchListSkeleton,
  RecordingHeader,
  RecordingPlayer,
  recordingActionClass,
  type RecordingHeaderFacts
} from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useShareLink } from '../client/useShareLink'
import { queryKeys } from '../queries/keys'

/** What the header says about a game, from its row in the player's history. */
export function headerFactsFor(match: MatchSummary | null | undefined, durationSeconds: number | null): RecordingHeaderFacts {
  return {
    championId: match?.championId ?? null,
    championName: match?.championName ?? null,
    queueId: match?.queueId ?? null,
    gameMode: match?.gameMode ?? null,
    durationSeconds: durationSeconds ?? match?.gameDuration ?? null,
    playedAt: match?.gameCreation ?? null,
    win: match ? match.win : null,
    kills: match?.kills ?? null,
    deaths: match?.deaths ?? null,
    assists: match?.assists ?? null
  }
}

/**
 * One player's recording of one game, from YouTube, with its markers.
 *
 * What "Watch recording" opens in a browser, and what a desktop opens for a
 * recording it has no file of — somebody else's, or its own after the file was
 * deleted. Always the named account's view: the page asks the server for that
 * account's recording of that game and nothing else, so a link to Ahri's
 * recording never shows Riven's, even of the same game.
 */
export function RecordingScreen({
  account,
  matchId,
  back,
  actions
}: {
  account: Account
  matchId: string
  /** The way back, where the host has one to offer. */
  back?: ReactNode
  /** Buttons of the host's own, beside the ones every client has. */
  actions?: ReactNode
}): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const share = useShareLink()

  const readRecording = client.matchRecordings?.get
  const readSummary = client.dashboard.matchSummary

  const recording = useQuery({
    queryKey: queryKeys.matchRecording(account.id, matchId),
    queryFn: () => readRecording!(account.id, matchId),
    enabled: readRecording !== undefined
  })

  const summary = useQuery({
    queryKey: queryKeys.matchSummary(account.id, matchId),
    queryFn: () => readSummary!(account.id, matchId),
    enabled: readSummary !== undefined
  })

  const facts = headerFactsFor(summary.data, recording.data?.durationSeconds ?? null)

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
            {share && video && <CopyLinkButton onCopy={() => share(paths.recording(account, matchId))} />}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}
