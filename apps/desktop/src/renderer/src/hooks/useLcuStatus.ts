import { useEffect, useState } from 'react'
import type { LcuStatus } from '@shared/types'

/**
 * The League client's current connection state, kept live.
 *
 * Reads the value once on mount and then follows the main process's pushes, so
 * every place that shows the status agrees without polling.
 */
export function useLcuStatus(): LcuStatus {
  const [status, setStatus] = useState<LcuStatus>({ state: 'disconnected' })

  useEffect(() => {
    let cancelled = false
    window.api.lcu.getStatus().then((initial) => {
      // A pushed update can land before the initial read resolves; ignoring the
      // stale answer keeps it from overwriting fresher state.
      if (!cancelled) setStatus(initial)
    })
    const unsubscribe = window.api.lcu.onStatus(setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return status
}
