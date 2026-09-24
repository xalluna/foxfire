import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { usePlatform } from '@foxfire/screens'
import { youtubeWatchUrl } from '@foxfire/core/youtube'
import {
  AttachLinkDialog,
  EmptyState,
  Icon,
  MatchListSkeleton,
  RecordingHeader,
  RecordingPlayer,
  Segmented,
  recordingActionClass,
  recordingPrimaryActionClass,
  type PlayerSource,
  type RecordingHeaderFacts
} from '@foxfire/ui'
import { useRecordingUpdates, useYouTubeUpdates } from '../hooks/useDesktopUpdates'
import { YouTubeUploadDialogHost } from '../youtube/YouTubeUploadDialog'
import { openUploadDialog } from '../youtube/uploadDialog'
import { uploadPending, uploadStatusText } from '../youtube/uploadStatus'
import { youtubeHostMount } from './youtubeHostMount'
import type { Recording } from '@shared/types'
import { YOUTUBE_ENABLED } from '@shared/features'

/**
 * A window that owns one recording.
 *
 * Several can be open at once — the same game at two timestamps on two
 * monitors is a real way to compare a botched fight against how it should have
 * gone — so unlike the telemetry panel and the LP editor this is not a
 * singleton on the main side. See recordingWindow.ts.
 *
 * Once a recording is on YouTube it plays from there by default, with a switch
 * back to the file while the file is still on this disk: YouTube is the copy
 * everybody else watches, and the file is the one with thumbnails on the seek
 * bar and slow motion.
 *
 * Loads the same renderer bundle as everything else, at `/recording/<id>` —
 * see router.tsx.
 */
function recordingIdFrom(param: string): number | null {
  const id = Number(param)
  return Number.isInteger(id) && id > 0 ? id : null
}

type Source = 'youtube' | 'file'

export function RecordingApp(): JSX.Element {
  const { id } = useParams({ from: '/_window/recording/$id' })
  const recordingId = recordingIdFrom(id)
  const mount = usePlatform().youtube ?? youtubeHostMount

  // An upload finishing, a link attached, the file deleted — all change what
  // this window can play, so it follows the same broadcasts the list does.
  useRecordingUpdates()
  useYouTubeUpdates()

  const detail = useQuery({
    queryKey: ['recordings', 'detail', recordingId],
    queryFn: () => window.api.recordings.detail(recordingId!),
    enabled: recordingId !== null
  })

  const [chosen, setChosen] = useState<Source | null>(null)
  const [attaching, setAttaching] = useState(false)

  if (recordingId === null) {
    return (
      <Shell>
        <EmptyState
          icon={<Icon.Warning />}
          title="No recording was named"
          description="This window was opened without a recording to show."
          tone="error"
        />
      </Shell>
    )
  }

  if (detail.isPending) {
    return (
      <Shell>
        <div className="p-6">
          <MatchListSkeleton rows={3} />
        </div>
      </Shell>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <Shell>
        <EmptyState
          icon={<Icon.Warning />}
          title="That recording is gone"
          description="It was deleted, or the database no longer knows about it."
          tone="error"
        />
      </Shell>
    )
  }

  const { recording, events } = detail.data
  // A build without YouTube plays the file and nothing else, whatever the row says.
  const videoId = YOUTUBE_ENABLED ? (recording.youtube?.videoId ?? null) : null
  const hasFile = recording.fileExists

  // YouTube once there is a copy there, the file otherwise — and whichever is
  // left when the one somebody picked goes away underneath them.
  const preferred: Source = chosen ?? (videoId ? 'youtube' : 'file')
  const source: Source | null =
    preferred === 'youtube' ? (videoId ? 'youtube' : hasFile ? 'file' : null) : hasFile ? 'file' : videoId ? 'youtube' : null

  const playerSource: PlayerSource | null =
    source === 'youtube' && videoId
      ? { kind: 'youtube', videoId, mount }
      : source === 'file'
        ? { kind: 'file', src: `recording://media/${recording.id}` }
        : null

  return (
    <Shell>
      <RecordingHeader
        facts={factsFor(recording)}
        status={statusFor(recording)}
        actions={
          <>
            {videoId && hasFile && (
              <Segmented
                options={[
                  ['youtube', 'YouTube'],
                  ['file', 'This PC']
                ]}
                value={source ?? 'youtube'}
                onChange={setChosen}
              />
            )}
            {YOUTUBE_ENABLED && hasFile && !videoId && !uploadPending(recording.upload) && (
              <button type="button" className={recordingActionClass} onClick={() => openUploadDialog(recording.id)}>
                Upload to YouTube
              </button>
            )}
            {YOUTUBE_ENABLED && (
              <button type="button" className={recordingActionClass} onClick={() => setAttaching(true)}>
                {videoId ? 'Replace YouTube link' : 'Attach YouTube link'}
              </button>
            )}
            {videoId && (
              <a
                href={youtubeWatchUrl(videoId)}
                target="_blank"
                rel="noreferrer"
                className={`${recordingActionClass} inline-flex items-center gap-1.5`}
              >
                <Icon.ExternalLink width={13} height={13} />
                Open on YouTube
              </a>
            )}
            {recording.match && (
              <button
                type="button"
                onClick={() => void window.api.recordings.showMatch(recording.accountId, recording.match!.matchId)}
                className={recordingPrimaryActionClass}
              >
                View match history
              </button>
            )}
          </>
        }
      />

      {playerSource ? (
        <RecordingPlayer key={source} source={playerSource} events={events} />
      ) : (
        <EmptyState
          icon={<Icon.Film />}
          title="The video file is missing"
          description="The recording is no longer where it was written. It may have been moved or deleted outside the app."
          tone="warning"
        />
      )}

      {attaching && (
        <AttachLinkDialog
          replacing={videoId !== null}
          withMarkers
          onAttach={(id, replace) => window.api.youtube.attachLink(recording.id, id, replace)}
          onClose={() => setAttaching(false)}
        />
      )}
      {YOUTUBE_ENABLED && <YouTubeUploadDialogHost canOpenSettings={false} />}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-screen flex-col bg-canvas text-text">{children}</div>
}

function factsFor(recording: Recording): RecordingHeaderFacts {
  const match = recording.match
  return {
    championId: match?.championId ?? recording.selfChampionId,
    championName: match?.championName ?? null,
    queueId: match?.queueId ?? recording.queueId,
    gameMode: match?.gameMode ?? null,
    durationSeconds: recording.durationSeconds,
    playedAt: recording.startedAt,
    win: match ? match.win : null,
    kills: match?.kills ?? null,
    deaths: match?.deaths ?? null,
    assists: match?.assists ?? null
  }
}

/** The quiet note beside the buttons: where the upload is, or the bind. */
function statusFor(recording: Recording): string | undefined {
  const upload = YOUTUBE_ENABLED ? uploadStatusText(recording) : null
  if (upload) return upload
  if (YOUTUBE_ENABLED && recording.youtube?.forcedPrivate) return 'Private on YouTube until Foxfire passes YouTube’s review'
  if (recording.bindState === 'pending') return 'Still looking for this game…'
  if (recording.bindState === 'unmatched') return 'No match history entry'
  return undefined
}
