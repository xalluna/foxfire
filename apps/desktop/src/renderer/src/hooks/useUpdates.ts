import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

/**
 * What the updater is doing, as the main process last said.
 *
 * Pushed rather than polled, and seeded with one read: a download that
 * finished while this window was closed has already announced itself to
 * nobody, and the banner has to know about it the moment the window opens.
 *
 * Null only until that first read answers, which is the one state with nothing
 * to say — every caller here treats it as "no news".
 */
export function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    let live = true

    void window.api.updates.getState().then((initial) => {
      // A pushed announcement that arrived while this was in flight is newer
      // than what it resolved with, so it must not be overwritten.
      if (live) setState((current) => current ?? initial)
    })

    const unsubscribe = window.api.updates.onChanged(setState)

    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  return state
}
