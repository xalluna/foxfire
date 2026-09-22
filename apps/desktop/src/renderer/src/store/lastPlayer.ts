import { create } from 'zustand'

/**
 * The account the player pages last showed.
 *
 * Which account is on screen lives in the URL now. This is only for the nav: on
 * Search or Settings there is no player in the URL, and "Champions" should
 * still mean the champions of whoever you were just looking at rather than
 * jumping back to the home account.
 *
 * An id rather than a slug, so a rename noticed by a sync does not strand it.
 * Not persisted — every launch opens on the home account, as it always has.
 */
interface LastPlayerState {
  accountId: string | null
  remember: (accountId: string) => void
}

export const useLastPlayer = create<LastPlayerState>((set) => ({
  accountId: null,
  remember: (accountId) => set({ accountId })
}))
