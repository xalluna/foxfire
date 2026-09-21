import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectionState } from '@foxfire/core'
import { useClient } from './context'
import { queryKeys } from '../queries/keys'

/**
 * Where the data is coming from, kept live.
 *
 * Read once and then followed, so every screen asking agrees without each one
 * holding its own copy — the connection used to be read by three components
 * separately, each with its own request.
 */
export function useConnection(): ConnectionState | undefined {
  const client = useClient()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: queryKeys.connection(),
    queryFn: () => client.connection.get(),
    staleTime: Infinity
  })

  useEffect(
    () =>
      client.connection.onChanged((state) => {
        queryClient.setQueryData(queryKeys.connection(), state)
      }),
    [client, queryClient]
  )

  return data
}

/** Whether the person signed in administers the server answering. */
export function useIsServerAdmin(): boolean {
  return useConnection()?.session?.isAdmin ?? false
}
