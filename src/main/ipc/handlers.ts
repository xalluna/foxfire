import { ipcMain } from 'electron'
import { CH } from './channels'
import { getSettings, removeApiKey, setAndValidateApiKey } from '../services/settingsService'
import {
  addAccount,
  getAccounts,
  getDashboard,
  getHome,
  removeAccount,
  setHome
} from '../services/accountService'
import { readSyncState, startSync } from '../services/syncService'
import { getAssetManifest } from '../services/ddragonService'
import {
  checkLiveGame,
  getParticipantRank,
  resolveParticipantName
} from '../services/liveGameService'
import { getMasteryData } from '../services/masteryService'
import { searchSummoner } from '../services/searchService'
import { getDb } from '../db'
import { getAccountById } from '../db/repositories/accounts.repo'
import { getMatchDetail, getMatchSummaries } from '../db/repositories/matches.repo'
import type { RiotIdInput } from '@shared/types'

export function registerIpcHandlers(): void {
  ipcMain.handle(CH.settings.get, () => getSettings())
  ipcMain.handle(CH.settings.setApiKey, (_e, key: string) => setAndValidateApiKey(key))
  ipcMain.handle(CH.settings.clearApiKey, () => {
    removeApiKey()
    return getSettings()
  })

  ipcMain.handle(CH.accounts.list, () => getAccounts())
  ipcMain.handle(CH.accounts.getHome, () => getHome())
  ipcMain.handle(CH.accounts.add, async (_e, input: RiotIdInput) => {
    const account = await addAccount(input)
    // Kick off the long match backfill without blocking the response, so the
    // UI can navigate to the new account and show progress immediately.
    startSync(account.id)
    return account
  })
  ipcMain.handle(CH.accounts.remove, (_e, accountId: number) => {
    removeAccount(accountId)
    return getAccounts()
  })
  ipcMain.handle(CH.accounts.setHome, (_e, accountId: number) => {
    setHome(accountId)
    return getAccounts()
  })

  ipcMain.handle(CH.dashboard.get, (_e, accountId: number) => getDashboard(accountId))
  ipcMain.handle(
    CH.dashboard.matchList,
    (_e, accountId: number, limit: number, offset: number) => {
      const account = getAccountById(getDb(), accountId)
      if (!account) return []
      return getMatchSummaries(getDb(), account.puuid, limit, offset)
    }
  )
  ipcMain.handle(CH.dashboard.matchDetail, (_e, matchId: string) =>
    getMatchDetail(getDb(), matchId)
  )

  ipcMain.handle(CH.sync.start, (_e, accountId: number) => {
    startSync(accountId)
  })
  ipcMain.handle(CH.sync.getState, (_e, accountId: number) => readSyncState(accountId))

  ipcMain.handle(CH.assets.get, () => getAssetManifest())

  ipcMain.handle(CH.liveGame.check, (_e, accountId: number) => checkLiveGame(accountId))
  ipcMain.handle(CH.liveGame.participantRank, (_e, platform: string, puuid: string) =>
    getParticipantRank(platform, puuid)
  )
  ipcMain.handle(CH.liveGame.participantName, (_e, regionalRoute: string, puuid: string) =>
    resolveParticipantName(regionalRoute, puuid)
  )

  ipcMain.handle(CH.mastery.get, (_e, accountId: number, refresh: boolean) =>
    getMasteryData(accountId, refresh)
  )

  ipcMain.handle(CH.search.summoner, (_e, input: RiotIdInput) => searchSummoner(input))
}
