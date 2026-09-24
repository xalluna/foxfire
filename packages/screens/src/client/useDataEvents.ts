import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useClient } from './context'
import { invalidationsFor, type DataEvent } from '../queries/invalidations'
import { useSyncProgressStore } from '../store/syncProgress'

/**
 * Subscribes once, at the root: sync progress into its store, and every event
 * into the refreshes it calls for.
 *
 * The events arrive from wherever the change happened — the desktop's own main
 * process, a server's push channel, another window — and the screens do not
 * care which. What goes stale for each is decided in invalidationsFor.
 */
export function useDataEvents(): void {
  const client = useClient()
  const queryClient = useQueryClient()
  const record = useSyncProgressStore((state) => state.record)

  useEffect(() => {
    const refresh = (event: DataEvent): void => {
      for (const queryKey of invalidationsFor(event)) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }

    const unsubscribers = [
      client.events.onSyncProgress((event) => {
        record(event)
        refresh({ kind: 'syncProgress', event })
      }),
      client.events.onRankEdited((accountId) => refresh({ kind: 'rankEdited', accountId })),
      client.events.onRankChanged((accountId) => refresh({ kind: 'rankChanged', accountId })),
      client.events.onRecordingChanged(({ accountId, matchId }) =>
        refresh({ kind: 'recordingChanged', accountId, matchId })
      )
    ]

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [client, queryClient, record])
}
