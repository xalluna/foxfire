import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { SearchPage, parseRiotId, randomExampleRiotId } from '@foxfire/ui'
import { useClient } from '../client/context'

/**
 * One-off lookup for summoners nobody tracks.
 *
 * Fetched live and never stored — on a server, by the server with its own key.
 */
export function SearchScreen(): JSX.Element {
  const client = useClient()
  // Drawn once per mount so the failure message names the player the
  // placeholder just showed.
  const [example] = useState(randomExampleRiotId)

  const search = useMutation({
    mutationFn: (raw: string) => {
      const parsed = parseRiotId(raw)
      if (!parsed) throw new Error(`Enter a Riot ID like ${example}`)
      return client.search.summoner(parsed)
    }
  })

  return (
    <SearchPage
      example={example}
      onSearch={(raw) => search.mutate(raw)}
      result={search.data}
      pending={search.isPending}
      error={search.isError ? (search.error instanceof Error ? search.error.message : 'Unknown error') : null}
    />
  )
}
