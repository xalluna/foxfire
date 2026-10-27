import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LADDERS,
  type EditableMatch,
  type ManualRankEdit,
  type QueueType,
  type TftEditableMatch
} from '@foxfire/core'
import { LpEditorPage } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'

/**
 * Hand-entering LP for the ranked games attribution could not settle.
 *
 * The same screen wherever it is hosted: in a window of its own on the desktop,
 * opened from a right-click in another one, and as a page in a browser.
 *
 * The ladder says which game: TFT's Ranked and Double Up are read and written
 * through TFT's rank, League's two through League's. Nothing else needs to
 * travel with it, so a desktop window or a link opens on the right game from
 * the ladder alone.
 */
export function LpEditorScreen({
  accountId,
  queueType,
  focusMatchId
}: {
  accountId: string
  queueType: QueueType
  /** The game the editor was opened on. */
  focusMatchId: string | null
}): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()
  const tft = LADDERS[queueType].game === 'tft'

  const read = (): Promise<Array<EditableMatch | TftEditableMatch>> =>
    tft ? client.tft.rank.editable(accountId, queueType) : client.rank.editable(accountId, queueType)

  const write = (edits: ManualRankEdit[]): Promise<Array<EditableMatch | TftEditableMatch>> =>
    tft
      ? client.tft.rank.saveManual(accountId, queueType, edits)
      : client.rank.saveManual(accountId, queueType, edits)

  const editable = useQuery({
    queryKey: queryKeys.editableMatches(accountId, queueType),
    queryFn: read
  })

  return (
    <LpEditorPage
      queueType={queueType}
      matches={editable.data}
      loading={editable.isPending}
      focusedMatchId={focusMatchId}
      onSave={async (edits) => {
        // The answer is the fresh list, which is usually shorter than what went
        // in — stating one game's rank can settle its neighbours on its own.
        const fresh = await write(edits)
        queryClient.setQueryData(queryKeys.editableMatches(accountId, queueType), fresh)
      }}
    />
  )
}
