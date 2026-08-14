import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUiStore } from '../store/uiStore'

/**
 * Subscribes once at the app root: mirrors main-process sync events into the
 * UI store and refreshes cached match data when a sync finishes.
 */
export function useSyncProgress(): void {
  const setSyncProgress = useUiStore((s) => s.setSyncProgress)
  const queryClient = useQueryClient()

  useEffect(() => {
    return window.api.sync.onProgress((event) => {
      setSyncProgress(event)
      if (event.phase === 'complete') {
        queryClient.invalidateQueries({ queryKey: ['matchList'] })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      }
    })
  }, [setSyncProgress, queryClient])
}
