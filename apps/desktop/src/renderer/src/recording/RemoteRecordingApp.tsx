import { useParams } from '@tanstack/react-router'
import { EmptyState, Icon, MatchListSkeleton, recordingPrimaryActionClass } from '@foxfire/ui'
import { RecordingScreen, useAccount } from '@foxfire/screens'

/**
 * A recording this machine has no file of, in a window of its own.
 *
 * Somebody else's — a friend's view of a game, opened from their history — or
 * this machine's own after its file was forgotten. Either way it is the
 * server's copy, played from YouTube, so the window is the shared recording
 * screen the web shows, rather than the local player with its file and its
 * upload buttons.
 */
export function RemoteRecordingApp(): JSX.Element {
  const { accountId, matchId } = useParams({ from: '/_window/recording/match/$accountId/$matchId' })
  const found = useAccount(accountId)
  const account = found.data ?? null

  return (
    <div className="flex h-screen flex-col bg-canvas text-text">
      {found.isPending ? (
        <div className="p-6">
          <MatchListSkeleton rows={3} />
        </div>
      ) : !account ? (
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="That player is not on this server"
          description="The recording belongs to an account the server you are connected to does not track."
        />
      ) : (
        <RecordingScreen
          account={account}
          matchId={matchId}
          actions={
            <button
              type="button"
              className={recordingPrimaryActionClass}
              onClick={() => void window.api.recordings.showMatch(account.id, matchId)}
            >
              View match history
            </button>
          }
        />
      )}
    </div>
  )
}
