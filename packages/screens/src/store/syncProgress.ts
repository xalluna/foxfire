import { create } from 'zustand'
import type { SyncProgressEvent } from '@foxfire/core'

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
