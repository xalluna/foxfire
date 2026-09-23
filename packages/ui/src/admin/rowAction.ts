import { useState } from 'react'
import type { AdminActionResult } from '@foxfire/core'

/**
 * Tracks one refusable action per row: which row is in flight, and the
 * server's reason the last one was refused.
 *
 * Its own module because two admin pages now list rows with an action on each —
 * League accounts unlinks them, Data & storage removes replays — and the second
 * page that needed it would otherwise have copied it.
 */
export function useRowAction(run: (id: string) => Promise<AdminActionResult>): {
  pendingId: string | null
  error: string | null
  start: (id: string) => void
} {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  return {
    pendingId,
    error,
    start: (id) => {
      setPendingId(id)
      run(id)
        .then((result) => setError(result.ok ? null : result.error))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setPendingId(null))
    }
  }
}
