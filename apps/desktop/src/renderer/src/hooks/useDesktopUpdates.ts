import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@foxfire/screens'

/*
 * The refreshes only the desktop needs. Sync progress, LP edits and League
 * client readings are refreshed by the shared screens' own subscription; what
 * is left is what happens to files on this disk.
 */

/**
 * Refreshes the recording list and the match rows when a recording appears,
 * binds to its match, or is deleted.
 *
 * The match list matters as much as the list of recordings: a row's context menu
 * offers "Watch recording" only when the row carries a recording id, and that id
 * arrives minutes after the game ends, when the match finally syncs and the
 * fingerprint matches. Without this the option stays greyed out until something
 * else happens to refetch.
 */
export function useRecordingUpdates(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    return window.api.recordings.onChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['recordings'] })
      queryClient.invalidateQueries({ queryKey: ['recordingUsage'] })
      queryClient.invalidateQueries({ queryKey: queryKeys.matchLists() })
    })
  }, [queryClient])
}

/**
 * Keeps the Replays tab and the match rows current.
 *
 * Separate from useRecordingUpdates because the two broadcast independently:
 * replays arrive from a folder watcher that knows nothing about capture, and a
 * sync that links one touches neither OBS nor the recordings table.
 */
export function useReplayUpdates(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    return window.api.replays.onChanged(() => {
      queryClient.invalidateQueries({ queryKey: ['replays'] })
      queryClient.invalidateQueries({ queryKey: ['replayUsage'] })
      // The match rows carry a marker for either artefact, so they go stale too.
      queryClient.invalidateQueries({ queryKey: queryKeys.matchLists() })
    })
  }, [queryClient])
}
