import { create } from 'zustand'
import type { SyncProgressEvent } from '@shared/types'
import { DEFAULT_QUEUE_FILTER } from '@shared/queues'

export type View =
  | 'dashboard'
  | 'liveGame'
  | 'captures'
  | 'mastery'
  | 'rank'
  | 'search'
  | 'settings'

interface UiState {
  activeAccountId: number | null
  view: View
  syncProgress: Record<number, SyncProgressEvent>
  /**
   * Queue filters, held per page rather than globally so browsing ARAM history
   * does not silently rescope champion stats.
   *
   * This store has no `persist` middleware, which is the whole mechanism behind
   * the intended behaviour: a selection survives navigating between pages, and
   * every app launch starts back on Ranked Solo/Duo.
   */
  matchQueueFilter: number | null
  championQueueFilter: number | null
  setActiveAccount: (id: number | null) => void
  setView: (view: View) => void
  setSyncProgress: (event: SyncProgressEvent) => void
  setMatchQueueFilter: (queueId: number | null) => void
  setChampionQueueFilter: (queueId: number | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeAccountId: null,
  view: 'dashboard',
  syncProgress: {},
  matchQueueFilter: DEFAULT_QUEUE_FILTER,
  championQueueFilter: DEFAULT_QUEUE_FILTER,
  setActiveAccount: (id) => set({ activeAccountId: id }),
  setView: (view) => set({ view }),
  setSyncProgress: (event) =>
    set((state) => ({ syncProgress: { ...state.syncProgress, [event.accountId]: event } })),
  setMatchQueueFilter: (queueId) => set({ matchQueueFilter: queueId }),
  setChampionQueueFilter: (queueId) => set({ championQueueFilter: queueId })
}))
