import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { getChampionStats, getMatchDetail, getMatchSummaries } from '../db/repositories/matches.repo'
import { listSeasons, saveSeasons } from '../db/repositories/seasons.repo'
import {
  addAccount,
  getAccounts,
  getDashboard,
  getHome,
  removeAccount,
  setHome
} from '../services/accountService'
import { readSyncState, startSync } from '../services/syncService'
import { getMasteryData } from '../services/masteryService'
import { getRankHistory, getRankPeriods } from '../services/rankHistoryService'
import { clearManualRank, getEditableMatches, saveManualRanks } from '../services/manualRankService'
import { searchSummoner } from '../services/searchService'
import { rangeBounds } from '@foxfire/core'
import type { StoredAccount } from '../db/repositories/accounts.repo'
import type { Account } from '@shared/types'
import type { ServerBackedApi } from './types'

/**
 * Everything the renderer reads, answered out of this machine's own database.
 *
 * This is local-only mode, and it is also the whole app as it stands today —
 * the code here is the bodies that used to live inline in the ipcMain.handle
 * callbacks, moved somewhere they can be named, typed against the contract, and
 * stood next to an alternative.
 *
 * Several of these went straight to a repository from the handler, skipping the
 * service layer, which meant there was no single layer to swap. They go through
 * here now. The repositories themselves are unchanged: they already take a `db`
 * as their first argument and never reach for the singleton, which is what
 * makes them the one part of this that a server could reuse the shape of.
 *
 * A note on the account lookups. Riot encrypts puuids per API key, so what is
 * stored is only meaningful to the key that fetched it, and every read below
 * that filters by player has to turn an account id into the puuid this
 * database was written with. Returning an empty list for an unknown account is
 * deliberate: the renderer can ask about an account that was deleted in another
 * window between its render and its fetch, and that is not an error worth
 * showing anybody.
 */
/**
 * This machine's own id, out of the opaque one the renderer holds.
 *
 * An id minted by a Foxfire Server is a GUID and parses to NaN here, which is
 * the right answer rather than a problem to guard against: every lookup below
 * misses, and the reads return empty the same way they do for an account
 * deleted in another window. Nothing is invented for an id from somewhere else.
 */
function rowId(accountId: string): number {
  return Number(accountId)
}

/** The same account, spelled the way the renderer takes it. */
function wire(account: StoredAccount): Account {
  return { ...account, id: String(account.id) }
}

export const localApi: ServerBackedApi = {
  accounts: {
    list: async () => getAccounts().map(wire),
    getHome: async () => {
      const home = getHome()
      return home ? wire(home) : null
    },
    add: async (input) => {
      const account = await addAccount(input)
      // Not awaited. The backfill is up to 200 matches through a rate limiter
      // and takes minutes; the account itself exists now, so the UI navigates
      // to it and watches sync:progress fill it in.
      startSync(account.id)
      return wire(account)
    },
    // Nothing to attest to: every account in this file is already yours, so
    // claiming one and tracking one are the same act.
    link: async (input) => {
      const account = await addAccount(input)
      startSync(account.id)
      return wire(account)
    },

    remove: async (accountId) => {
      removeAccount(rowId(accountId))
      return getAccounts().map(wire)
    },
    setHome: async (accountId) => {
      setHome(rowId(accountId))
      return getAccounts().map(wire)
    }
  },

  dashboard: {
    get: async (accountId) => {
      const data = getDashboard(rowId(accountId))
      return data ? { ...data, account: wire(data.account) } : null
    },
    matchList: async (accountId, limit, offset, queueId) => {
      const db = getDb()
      const account = getAccountById(db, rowId(accountId))
      if (!account) return []
      return getMatchSummaries(db, account.puuid, limit, offset, queueId)
    },
    matchDetail: async (matchId) => getMatchDetail(getDb(), matchId)
  },

  sync: {
    start: async (accountId) => {
      startSync(rowId(accountId))
    },
    getState: async (accountId) => readSyncState(rowId(accountId))
  },

  champions: {
    stats: async (accountId, queueId, range) => {
      const db = getDb()
      const account = getAccountById(db, rowId(accountId))
      if (!account) return []
      const { sinceMs, untilMs } = rangeBounds(range, listSeasons(db))
      return getChampionStats(db, account.puuid, queueId, sinceMs, untilMs)
    }
  },

  mastery: {
    get: async (accountId, refresh, queueId) => getMasteryData(rowId(accountId), refresh, queueId)
  },

  rank: {
    history: async (accountId, queueType, range) =>
      getRankHistory(rowId(accountId), queueType, range),
    periods: async (accountId) => getRankPeriods(rowId(accountId)),
    editable: async (accountId, queueType) => {
      const db = getDb()
      const id = rowId(accountId)
      const account = getAccountById(db, id)
      if (!account) return []
      return getEditableMatches(db, id, account.puuid, queueType)
    },

    // Both writers return the fresh list rather than void: an edit can resolve a
    // neighbouring game on its own, so what the editor should show afterwards is
    // not something it can work out from what it sent.
    //
    // They broadcast too, because the window that has to react is not the one
    // that called: the editor is its own renderer with its own query cache, and
    // the match list and rank graph it just changed are in the main window. The
    // implementation that wrote the rows is the thing that knows they landed, so
    // telling the windows belongs here rather than in the handler — and an HTTP
    // implementation would not do it at all, since a server's writes arrive
    // back over its own event stream.
    saveManual: async (accountId, queueType, edits) => {
      const db = getDb()
      const id = rowId(accountId)
      const account = getAccountById(db, id)
      if (!account) return []
      saveManualRanks(db, id, account.puuid, queueType, edits)
      broadcast(CH.rank.edited, accountId)
      return getEditableMatches(db, id, account.puuid, queueType)
    },
    clearManual: async (accountId, queueType, matchId) => {
      const db = getDb()
      const id = rowId(accountId)
      const account = getAccountById(db, id)
      if (!account) return []
      if (clearManualRank(db, id, account.puuid, matchId)) {
        broadcast(CH.rank.edited, accountId)
      }
      return getEditableMatches(db, id, account.puuid, queueType)
    }
  },

  seasons: {
    list: async () => listSeasons(getDb()),
    save: async (seasons) => saveSeasons(getDb(), seasons)
  },

  search: {
    summoner: async (input) => searchSummoner(input)
  }
}
