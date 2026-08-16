import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { getHomeAccount } from '../db/repositories/accounts.repo'
import { RiotApiError } from '../riot/rateLimiter'
import { setApiKey as applyApiKey, rateLimiter } from '../riot/client'
import { checkPlatformStatus } from '../riot/endpoints/status'
import { DEFAULT_PLATFORM } from '../riot/regions'
import { clearApiKey, loadApiKey, saveApiKey } from '../security/keyStore'
import type { AppSettingsPublic } from '@shared/types'

/** Loads any previously stored key into the Riot client at startup. */
export function initSettings(): void {
  const key = loadApiKey()
  if (key) applyApiKey(key)

  // Personal keys expire every 24h; tell the renderer so it can prompt for a
  // fresh one instead of leaving the user staring at failed lookups.
  rateLimiter.on('key-invalid', () => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CH.settings.keyInvalid)
    }
  })
}

export function getSettings(): AppSettingsPublic {
  const home = getHomeAccount(getDb())
  return {
    hasApiKey: loadApiKey() !== null,
    homeAccountId: home?.id ?? null,
    keyRejected: rateLimiter.keyRejected
  }
}

export interface ValidateResult {
  ok: boolean
  message?: string
}

/**
 * Verifies the key against Riot before persisting it, so an expired or
 * mistyped key is reported right away instead of failing mid-backfill.
 */
export async function setAndValidateApiKey(key: string): Promise<ValidateResult> {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, message: 'Key cannot be empty' }

  const previous = loadApiKey()
  applyApiKey(trimmed)
  rateLimiter.resume()

  try {
    await checkPlatformStatus(DEFAULT_PLATFORM)
  } catch (err) {
    // Restore whatever was working before so a bad paste doesn't break the app.
    applyApiKey(previous)
    if (err instanceof RiotApiError && (err.status === 401 || err.status === 403)) {
      return { ok: false, message: 'Riot rejected this key. Personal keys expire every 24h — grab a fresh one.' }
    }
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reach Riot' }
  }

  saveApiKey(trimmed)
  return { ok: true }
}

export function removeApiKey(): void {
  clearApiKey()
  applyApiKey(null)
}
