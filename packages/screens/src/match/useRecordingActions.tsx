import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Account, AttachRecordingOutcome, MatchSummary } from '@foxfire/core'
import { AttachLinkDialog, ConfirmDialog } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from '../queries/keys'
import type { MatchMenuActions, MatchMenuContext } from './matchMenu'

type RecordingMenuActions = Pick<
  MatchMenuActions,
  'onWatchRecording' | 'onUploadRecording' | 'onAttachRecordingLink' | 'onDetachRecording'
>

/**
 * Everything a match row can do with a recording, for one account's history.
 *
 * Shared by the history and the page for a single game, because both offer
 * the same four things and both need the same two questions asked on the way:
 * which link to attach, and whether to really take a recording off. The
 * answers are always about the account whose history this is — the row's
 * player — which is what keeps somebody else's recording off it.
 */
export function useRecordingActions(account: Account): {
  actionsFor: (match: MatchSummary) => RecordingMenuActions
  menuContext: Pick<MatchMenuContext, 'isAdmin' | 'serverMode'>
  dialogs: JSX.Element
} {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const connection = useConnection()

  const [attaching, setAttaching] = useState<MatchSummary | null>(null)
  const [detaching, setDetaching] = useState<MatchSummary | null>(null)
  const [detachBusy, setDetachBusy] = useState(false)
  const [detachError, setDetachError] = useState<string | null>(null)

  // Attaching and removing are YouTube's, so only where YouTube plays: a client
  // built without it has no player, and offers neither.
  const youtube = platform.youtube !== undefined
  const serverRecordings = youtube ? client.matchRecordings : undefined
  const canAttach = youtube && (platform.attachRecordingLink !== undefined || serverRecordings !== undefined)

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.matchList(account.id) })
  }

  const actionsFor = (match: MatchSummary): RecordingMenuActions => ({
    onWatchRecording: platform.watchRecording
      ? () => platform.watchRecording?.({ account, match })
      : undefined,
    onUploadRecording: platform.uploadRecording
      ? () => platform.uploadRecording?.({ account, match })
      : undefined,
    onAttachRecordingLink: canAttach ? () => setAttaching(match) : undefined,
    onDetachRecording: serverRecordings
      ? () => {
          setDetachError(null)
          setDetaching(match)
        }
      : undefined
  })

  /**
   * The desktop's own recording first, because it carries the markers; the
   * server directly when this machine has none of the game, as a browser
   * always does.
   */
  const attach = async (match: MatchSummary, videoId: string, replace: boolean): Promise<AttachRecordingOutcome> => {
    const fromThisMachine = await platform.attachRecordingLink?.({ account, match, videoId, replace })

    const outcome: AttachRecordingOutcome =
      fromThisMachine ??
      (serverRecordings
        ? await serverRecordings.attach(account.id, match.matchId, { youtubeVideoId: videoId, source: 'link', replace })
        : { ok: false, reason: 'failed', message: 'There is nowhere to attach a link to from here.' })

    if (outcome.ok) refresh()
    return outcome
  }

  const detach = async (match: MatchSummary): Promise<void> => {
    if (!serverRecordings) return
    setDetachBusy(true)
    try {
      const result = await serverRecordings.detach(account.id, match.matchId)
      if (result.ok) {
        setDetaching(null)
        refresh()
      } else {
        setDetachError(result.error ?? 'The recording could not be removed.')
      }
    } finally {
      setDetachBusy(false)
    }
  }

  const dialogs = (
    <>
      {attaching && (
        <AttachLinkDialog
          replacing={Boolean(attaching.recording || attaching.local?.recordingVideoId)}
          withMarkers={
            platform.attachRecordingLink !== undefined && (attaching.local?.recordingId ?? null) !== null
          }
          onAttach={(videoId, replace) => attach(attaching, videoId, replace)}
          onClose={() => setAttaching(null)}
        />
      )}
      {detaching && (
        <ConfirmDialog
          title="Remove this recording?"
          message={
            <>
              It comes off {account.gameName}&rsquo;s history on this server, for everybody. The video
              itself stays on YouTube — Foxfire never deletes anything there.
            </>
          }
          confirmLabel="Remove"
          danger
          busy={detachBusy}
          error={detachError}
          onConfirm={() => void detach(detaching)}
          onCancel={() => setDetaching(null)}
        />
      )}
    </>
  )

  return {
    actionsFor,
    menuContext: {
      isAdmin: connection?.session?.isAdmin ?? false,
      serverMode: connection?.mode === 'server'
    },
    dialogs
  }
}
