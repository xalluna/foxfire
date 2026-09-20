import { app } from 'electron'
import { getDb } from '../db'
import { getBoolSetting, getSetting, setBoolSetting, setSetting } from '../db/repositories/appSettings.repo'
import { LCU_PATH_SETTING, startLcuWatcher, stopLcuWatcher } from '../lcu/watcher'
import type { BackgroundSettings } from '@shared/types'

const RUN_IN_TRAY = 'background.runInTray'
const LAUNCH_AT_STARTUP = 'background.launchAtStartup'

/**
 * Background behaviour, which the LCU watcher depends on.
 *
 * Rank can only be captured per-game while the app is actually running, so
 * closing the window has to keep the process alive for the feature to be worth
 * anything. Both switches are opt-in and default off — an app that silently
 * survives its own close button, or adds itself to startup, should be something
 * the user chose.
 */
export function getBackgroundSettings(): BackgroundSettings {
  const db = getDb()
  return {
    runInTray: getBoolSetting(db, RUN_IN_TRAY, false),
    launchAtStartup: getBoolSetting(db, LAUNCH_AT_STARTUP, false),
    lcuInstallPath: getSetting(db, LCU_PATH_SETTING)
  }
}

export function setBackgroundSettings(patch: Partial<BackgroundSettings>): BackgroundSettings {
  const db = getDb()

  if (patch.runInTray !== undefined) setBoolSetting(db, RUN_IN_TRAY, patch.runInTray)
  if (patch.launchAtStartup !== undefined) {
    setBoolSetting(db, LAUNCH_AT_STARTUP, patch.launchAtStartup)
    applyLaunchAtStartup(patch.launchAtStartup)
  }
  if (patch.lcuInstallPath !== undefined) {
    setSetting(db, LCU_PATH_SETTING, patch.lcuInstallPath?.trim() || null)
    // Re-detect immediately rather than making the user wait for the next poll
    // to find out whether the path they typed was right.
    restartLcuWatcher()
  }

  return getBackgroundSettings()
}

function applyLaunchAtStartup(enabled: boolean): void {
  // openAsHidden keeps a startup launch from stealing focus with a window the
  // user did not ask to see; the tray icon is the only sign it is running.
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
}

function restartLcuWatcher(): void {
  stopLcuWatcher()
  startLcuWatcher()
}

export function initBackground(): void {
  const settings = getBackgroundSettings()
  // Re-assert on every launch so the OS setting cannot drift from the stored
  // preference (an uninstall/reinstall clears the login item silently).
  applyLaunchAtStartup(settings.launchAtStartup)

  // Always watch, regardless of tray mode. The two are independent: this
  // captures rank for as long as the app is running, and tray mode only decides
  // whether that outlives the window. Gating it on tray meant a user with both
  // the app and League open in front of them was told no client was detected.
  startLcuWatcher()
}
