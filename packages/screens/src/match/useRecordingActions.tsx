import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Account, GameId } from '@foxfire/core'
import { ConfirmDialog } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from '../queries/keys'
import type { RecordingTarget } from '../client/context'
import type { MatchMenuActions, MatchMenuContext } from './matchMenu'

/** A row's game, as far as its recording goes. League's and TFT's rows are both one. */
type RecordableMatch = RecordingTarget['match']

type RecordingMenuActions = Pick<MatchMenuActions, 'onWatchRecording' | 'onUploadRecording' | 'onDetachRecording'>

/**
 * Everything a match row can do with a recording, for one account's history.
 *
 * Shared by the history and the page for a single game, because both offer
 * the same three things and both need the same question asked on the way:
 * whether to really take a recording off. The answers are always about the
 * account whose history this is — the row's player — which is what keeps
 * somebody else's recording off it.
 */
export function useRecordingActions(
  account: Account,
  game: GameId = 'lol'
): {
  actionsFor: (match: RecordableMatch) => RecordingMenuActions
  menuContext: Pick<MatchMenuContext, 'isAdmin'>
  dialogs: JSX.Element
} {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const connection = useConnection()

  const [detaching, setDetaching] = useState<RecordableMatch | null>(null)
  const [detachBusy, setDetachBusy] = useState(false)
  const [detachError, setDetachError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Uploading and removing are the server's, so only where the server keeps
  // recordings and this client has a player for them.
  const recordings = connection?.recordings === true && platform.media !== undefined
  const serverRecordings = recordings ? client.matchRecordings : undefined

  const refresh = (): void => {
    void queryClient.invalidateQueries({
      queryKey: game === 'tft' ? queryKeys.tftMatchList(account.id) : queryKeys.matchList(account.id)
    })
  }

  const upload = async (match: RecordableMatch): Promise<void> => {
    const outcome = await platform.uploadRecording?.({ account, match, game })
    if (!outcome) return
    if (outcome.ok) refresh()
    else setUploadError(outcome.message ?? 'The recording could not be queued.')
  }

  const actionsFor = (match: RecordableMatch): RecordingMenuActions => ({
    onWatchRecording: platform.watchRecording
      ? () => platform.watchRecording?.({ account, match, game })
      : undefined,
    onUploadRecording:
      recordings && platform.uploadRecording ? () => void upload(match) : undefined,
    onDetachRecording: serverRecordings
      ? () => {
          setDetachError(null)
          setDetaching(match)
        }
      : undefined
  })

  const detach = async (match: RecordableMatch): Promise<void> => {
    if (!serverRecordings) return
    setDetachBusy(true)
    try {
      const result = await serverRecordings.remove(account.id, match.matchId)
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
      {detaching && (
        <ConfirmDialog
          title="Remove this recording?"
          message={
            <>
              It comes off {account.gameName}&rsquo;s history on this server, for everybody, and its
              video is deleted from the server. A copy still on the PC that recorded it stays there.
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
      {uploadError && (
        <ConfirmDialog
          title="The recording was not queued"
          message={uploadError}
          confirmLabel="OK"
          onConfirm={() => setUploadError(null)}
          onCancel={() => setUploadError(null)}
        />
      )}
    </>
  )

  return {
    actionsFor,
    menuContext: { isAdmin: connection?.session?.isAdmin ?? false },
    dialogs
  }
}
