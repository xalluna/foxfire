import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueueType } from '@foxfire/core'
import { LpEditorPage } from '@foxfire/ui'
import { useClient } from '../client/context'
import { queryKeys } from '../queries/keys'

/**
 * Hand-entering LP for the ranked games attribution could not settle.
 *
 * The same screen wherever it is hosted: in a window of its own on the desktop,
 * opened from a right-click in another one, and as a page in a browser.
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

  const editable = useQuery({
    queryKey: queryKeys.editableMatches(accountId, queueType),
    queryFn: () => client.rank.editable(accountId, queueType)
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
        const fresh = await client.rank.saveManual(accountId, queueType, edits)
        queryClient.setQueryData(queryKeys.editableMatches(accountId, queueType), fresh)
      }}
    />
  )
}
