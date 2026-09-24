import type { FoxfireData } from '../client'
import type { Account } from '../types'
import type { ServerApi } from './api'
import { homeAmong, markHome, type HomeAccountStore } from './home'

/**
 * Everything a screen reads, answered by a Foxfire Server.
 *
 * The mirror image of the desktop's local-only implementation, method for
 * method, because both satisfy the same contract. That is the whole design, and
 * it is why this file has almost no decisions in it — the server made them.
 *
 * The one thing that happens here is the home account, which is a preference of
 * the machine or browser asking and so is stamped on by the caller's own store
 * on the way past. Match rows come back without anything from this machine's
 * disk; the desktop adds that on top, and a browser has nothing to add.
 */
export function createServerData(api: ServerApi, home: HomeAccountStore): FoxfireData {
  const mine = async (): Promise<Account[]> => markHome(await api.accounts.mine(), home.get())

  return {
    accounts: {
      mine,

      // One account's `isHomeAccount` is left as the server sends it, false.
      // Which account is home is `getHome`'s question, and the rail's list.
      get: api.accounts.get,
      find: api.accounts.find,

      getHome: async () => {
        const storedId = home.get()

        // Remembered, and possibly somebody else's — a browser can star a
        // friend's profile to open on. An account the server no longer has
        // falls through to your own, as nothing remembered would.
        if (storedId !== null) {
          const stored = await api.accounts.get(storedId)
          if (stored) return { ...stored, isHomeAccount: true }
        }

        const first = homeAmong(await api.accounts.mine(), null)
        return first && { ...first, isHomeAccount: true }
      },

      remove: async (accountId) => {
        await api.accounts.release(accountId)
        return mine()
      },

      setHome: async (accountId) => {
        home.set(accountId)
        return mine()
      }
    },

    dashboard: {
      get: api.dashboard.get,
      matchList: api.dashboard.matches,
      matchDetail: api.dashboard.matchDetail,
      matchSummary: api.dashboard.matchSummary
    },

    sync: {
      start: api.sync.start,
      getState: api.sync.getState
    },

    champions: { stats: api.champions.stats },

    mastery: { get: api.mastery.get },

    rank: {
      history: api.rank.history,
      periods: api.rank.periods,
      editable: api.rank.editable,
      saveManual: api.rank.saveManual,
      clearManual: api.rank.clearManual
    },

    seasons: {
      list: api.seasons.list,
      save: api.seasons.save
    },

    search: { players: api.search.players },

    matchRecordings: {
      get: api.matchRecordings.get,
      attach: api.matchRecordings.attach,
      detach: api.matchRecordings.detach
    }
  }
}
