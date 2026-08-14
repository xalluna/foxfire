import { create } from 'zustand'
import type { SyncProgressEvent } from '@shared/types'

export type View = 'dashboard' | 'liveGame' | 'mastery' | 'search' | 'settings'

interface UiState {
  activeAccountId: number | null
  view: View
  syncProgress: Record<number, SyncProgressEvent>
  setActiveAccount: (id: number | null) => void
  setView: (view: View) => void
  setSyncProgress: (event: SyncProgressEvent) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeAccountId: null,
  view: 'dashboard',
  syncProgress: {},
  setActiveAccount: (id) => set({ activeAccountId: id }),
  setView: (view) => set({ view }),
  setSyncProgress: (event) =>
    set((state) => ({ syncProgress: { ...state.syncProgress, [event.accountId]: event } }))
}))
