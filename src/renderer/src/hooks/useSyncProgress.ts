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
        queryClient.invalidateQueries({ queryKey: ['rankHistory'] })
        // Champion win rates are aggregated from the very matches a sync just
        // imported, so they are stale the moment it finishes. Without this they
        // keep serving pre-sync counts until the query ages out.
        queryClient.invalidateQueries({ queryKey: ['mastery'] })
      }
    })
  }, [setSyncProgress, queryClient])
}

/**
 * Refreshes rank-derived views when the League client watcher records an LP
 * change, so a game finished with the window open shows its chip without the
 * user having to hit sync.
 */
export function useLcuRankUpdates(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    return window.api.lcu.onRankChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['rankHistory'] })
      queryClient.invalidateQueries({ queryKey: ['matchList'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    })
  }, [queryClient])
}
