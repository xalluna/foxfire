import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SeasonsEditor } from '@foxfire/ui'
import { useClient } from '../client/context'
import { invalidationsFor } from '../queries/invalidations'
import { queryKeys } from '../queries/keys'

/**
 * The ranked season boundaries, entered by hand.
 *
 * A card rather than a page because where it lives differs: beside rank
 * tracking on the desktop, among a server's admin pages in a browser. On a
 * server only an admin may save one, and the server is the one that says so.
 */
export function SeasonsCard(): JSX.Element {
  const client = useClient()
  const queryClient = useQueryClient()

  const seasons = useQuery({
    queryKey: queryKeys.seasons(),
    queryFn: () => client.seasons.list()
  })

  return (
    <SeasonsEditor
      seasons={seasons.data}
      onSave={async (next) => {
        const saved = await client.seasons.save(next)
        queryClient.setQueryData(queryKeys.seasons(), saved)
        for (const queryKey of invalidationsFor({ kind: 'seasonsSaved' })) {
          void queryClient.invalidateQueries({ queryKey })
        }
        return saved
      }}
    />
  )
}
