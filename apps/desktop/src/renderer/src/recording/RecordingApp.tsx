import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { tftHeaderFactsFor, useMyAccounts } from '@foxfire/screens'
import {
  EmptyState,
  Icon,
  MatchListSkeleton,
  RecordingHeader,
  RecordingPlayer,
  recordingActionClass,
  recordingPrimaryActionClass,
  type RecordingHeaderFacts
} from '@foxfire/ui'
import { canUploadRecording } from '@shared/uploadEligibility'
import { useMediaUpdates, useRecordingUpdates } from '../hooks/useDesktopUpdates'
import { uploadStatusText } from '../media/uploadStatus'
import { useUploadServer } from '../media/useMedia'
import type { Recording } from '@shared/types'

/**
 * A window that owns one recording.
 *
 * Several can be open at once — the same game at two timestamps on two
 * monitors is a real way to compare a botched fight against how it should have
 * gone — so unlike the telemetry panel and the LP editor this is not a
 * singleton on the main side. See recordingWindow.ts.
 *
 * Plays the file on this disk, which is the one with thumbnails on the seek
 * bar and nothing to wait for. Once the file was deleted after upload, it
 * hands over to the server's copy, in a window of its own.
 *
 * Loads the same renderer bundle as everything else, at `/recording/<id>` —
 * see router.tsx.
 */
function recordingIdFrom(param: string): number | null {
  const id = Number(param)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function RecordingApp(): JSX.Element {
  const { id } = useParams({ from: '/_window/recording/$id' })
  const recordingId = recordingIdFrom(id)
  const server = useUploadServer()
  const mine = useMyAccounts().data ?? []
  const [queueing, setQueueing] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)

  // An upload finishing, the file deleted — both change what this window can
  // play, so it follows the same broadcasts the list does.
  useRecordingUpdates()
  useMediaUpdates()

  const detail = useQuery({
    queryKey: ['recordings', 'detail', recordingId],
    queryFn: () => window.api.recordings.detail(recordingId!),
    enabled: recordingId !== null
  })

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
  const onServer = recording.server !== null && recording.server.serverKey === server
  // Yours only: the server takes an upload from whoever claimed the account.
  const uploadable = canUploadRecording(recording, server, mine)

  const upload = async (): Promise<void> => {
    setQueueing(true)
    setQueueError(null)
    try {
      const result = await window.api.media.enqueue([recording.id])
      if (result.queued === 0) setQueueError(result.skipped[0]?.reason ?? 'It could not be queued.')
    } finally {
      setQueueing(false)
    }
  }

  return (
    <Shell>
      <RecordingHeader
        facts={factsFor(recording)}
        status={queueError ?? statusFor(recording)}
        actions={
          <>
            {uploadable && (
              <button type="button" className={recordingActionClass} disabled={queueing} onClick={() => void upload()}>
                {queueing ? 'Queueing…' : 'Upload to server'}
              </button>
            )}
            {onServer && recording.fileExists && (
              <button
                type="button"
                className={recordingActionClass}
                onClick={() => void window.api.recordings.openServerCopy(recording.id)}
              >
                Watch on the server
              </button>
            )}
            {(recording.match ?? recording.tftMatch) && (
              <button
                type="button"
                onClick={() =>
                  void window.api.recordings.showMatch(
                    recording.accountId,
                    (recording.match ?? recording.tftMatch)!.matchId,
                    recording.game
                  )
                }
                className={recordingPrimaryActionClass}
              >
                View match history
              </button>
            )}
          </>
        }
      />

      {recording.fileExists ? (
        <RecordingPlayer source={{ kind: 'file', src: `recording://media/${recording.id}` }} events={events} />
      ) : onServer ? (
        <EmptyState
          icon={<Icon.Film />}
          title="This recording plays from the server"
          description="Its file was deleted from this PC once the server had it."
          action={
            <button
              type="button"
              className={recordingPrimaryActionClass}
              onClick={() => void window.api.recordings.openServerCopy(recording.id)}
            >
              Watch it
            </button>
          }
        />
      ) : (
        <EmptyState
          icon={<Icon.Film />}
          title="The video file is missing"
          description="The recording is no longer where it was written. It may have been moved or deleted outside the app."
          tone="warning"
        />
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="flex h-screen flex-col bg-canvas text-text">{children}</div>
}

function factsFor(recording: Recording): RecordingHeaderFacts {
  // A TFT game's place and board where League's has a champion and a score;
  // one not yet found says only that it is TFT, and when.
  if (recording.game === 'tft') {
    return recording.tftMatch
      ? tftHeaderFactsFor(recording.tftMatch, recording.durationSeconds)
      : {
          championId: null,
          championName: 'TFT recording',
          queueId: recording.queueId,
          gameMode: 'TFT',
          durationSeconds: recording.durationSeconds,
          playedAt: recording.startedAt,
          win: null,
          kills: null,
          deaths: null,
          assists: null
        }
  }

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
  const upload = uploadStatusText(recording)
  if (upload) return upload
  if (recording.bindState === 'pending') return 'Still looking for this game…'
  if (recording.bindState === 'unmatched') return 'No match history entry'
  return undefined
}
