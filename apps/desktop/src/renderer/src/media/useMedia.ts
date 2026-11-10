import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ServerState, UploadQueueState } from '@shared/types'

/**
 * The upload queue, kept current by the main process's pushes — see
 * hooks/useDesktopUpdates.ts, which writes each one into this query.
 */
export function useUploadQueue(): UploadQueueState | undefined {
  return useQuery({ queryKey: ['mediaQueue'], queryFn: () => window.api.media.getQueue() }).data
}

/**
 * The server this PC is on, as far as uploading goes: its key, the one an
 * upload and a recording's server copy are filed under, when it keeps
 * recordings; null in local-only mode or on a server without them.
 */
export function useUploadServer(): string | null {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: ['serverState'], queryFn: () => window.api.server.getState() })

  useEffect(
    () => window.api.server.onChanged((next: ServerState) => queryClient.setQueryData(['serverState'], next)),
    [queryClient]
  )

  const server = state.data
  return server?.activeUrl && server.recordings ? server.activeUrl : null
}
