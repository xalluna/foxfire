import { create } from 'zustand'
import { DEFAULT_QUEUE_FILTER } from '@foxfire/core'

export type View =
  | 'dashboard'
  | 'liveGame'
  | 'captures'
  | 'mastery'
  | 'rank'
  | 'search'
  | 'settings'

interface UiState {
  activeAccountId: string | null
  view: View
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
  setActiveAccount: (id: string | null) => void
  setView: (view: View) => void
  setMatchQueueFilter: (queueId: number | null) => void
  setChampionQueueFilter: (queueId: number | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeAccountId: null,
  view: 'dashboard',
  matchQueueFilter: DEFAULT_QUEUE_FILTER,
  championQueueFilter: DEFAULT_QUEUE_FILTER,
  setActiveAccount: (id) => set({ activeAccountId: id }),
  setView: (view) => set({ view }),
  setMatchQueueFilter: (queueId) => set({ matchQueueFilter: queueId }),
  setChampionQueueFilter: (queueId) => set({ championQueueFilter: queueId })
}))
