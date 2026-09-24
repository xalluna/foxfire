import { create } from 'zustand'
import type { SyncProgressEvent, SyncState } from '@foxfire/core'

interface SyncProgressState {
  /** The latest event for each account, whichever phase it is in. */
  byAccount: Record<string, SyncProgressEvent>
  record: (event: SyncProgressEvent) => void
}

/**
 * How far each account's sync has got.
 *
 * Pushed rather than asked for — a backfill reports as it goes — so it lives in
 * a store the event subscription writes and any screen can read, rather than
 * in a query cache that would have to be told to refetch something it cannot
 * fetch. No persistence: a restart starts with nothing running.
 */
export const useSyncProgressStore = create<SyncProgressState>((set) => ({
  byAccount: {},
  record: (event) =>
    set((state) => ({ byAccount: { ...state.byAccount, [event.accountId]: event } }))
}))

/** The latest sync event for one account. */
export function useSyncProgress(accountId: string): SyncProgressEvent | undefined {
  return useSyncProgressStore((state) => state.byAccount[accountId])
}

/** Whether a sync is running, as opposed to finished or failed. */
export function isSyncing(progress: SyncProgressEvent | undefined): boolean {
  return progress !== undefined && progress.phase !== 'complete' && progress.phase !== 'error'
}

/**
 * When "Sync now" is next accepted for an account, or null if nothing says.
 *
 * Two answers, and the later one wins. The sync state is what the profile
 * opens with; a finished sync's event is what arrives the moment the spinner
 * stops, before the refetch it sets off has brought the state up to date.
 * Taking either alone would leave the button pressable for that round trip, or
 * blind to a sync finished before the page was opened.
 */
export function syncCooldownUntil(
  state: SyncState | null | undefined,
  progress: SyncProgressEvent | undefined
): string | null {
  const fromState = state?.cooldownUntil ?? null
  const fromEvent = progress?.phase === 'complete' ? (progress.cooldownUntil ?? null) : null

  if (fromState === null) return fromEvent
  if (fromEvent === null) return fromState
  return Date.parse(fromEvent) > Date.parse(fromState) ? fromEvent : fromState
}
