import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { getHomeAccount } from '../db/repositories/accounts.repo'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import { APPLICATION_KEY_LIMITS, PERSONAL_KEY_LIMITS, RiotApiError } from '../riot/rateLimiter'
import { setApiKey as applyApiKey, rateLimiter } from '../riot/client'
import { checkPlatformStatus } from '../riot/endpoints/status'
import { DEFAULT_PLATFORM } from '../riot/regions'
import { clearApiKey, loadApiKey, saveApiKey } from '../security/keyStore'
import { createLogger } from '../telemetry/logger'
import { repairAllIdentities } from './identityService'
import type { AppSettingsPublic, IdentityReport, RiotKeyLimits, RiotKeyType } from '@shared/types'

const log = createLogger('settings')

const KEY_TYPE_SETTING = 'riot.keyType'
const LIMITS_SETTING = 'riot.limits'

/** Loads any previously stored key into the Riot client at startup. */
export function initSettings(): void {
  const key = loadApiKey()
  if (key) applyApiKey(key)

  applyRateLimits()

  // Personal keys expire every 24h; tell the renderer so it can prompt for a
  // fresh one instead of leaving the user staring at failed lookups.
  rateLimiter.on('key-invalid', () => {
    broadcast(CH.settings.keyInvalid)
  })
}

export function getKeyType(): RiotKeyType {
  return getSetting(getDb(), KEY_TYPE_SETTING) === 'application' ? 'application' : 'personal'
}

/**
 * The per-10s and per-10min allowances of an approved application key.
 *
 * Stored rather than assumed because Riot grants them per product: the numbers
 * in APPLICATION_KEY_LIMITS are the usual ones, not a guarantee, and pacing to
 * an allowance larger than the one actually granted just means every backfill
 * ends in 429s.
 *
 * A malformed or absent value falls back to the defaults rather than throwing.
 * This is read on the path that dispatches every Riot request, and a settings
 * row someone hand-edited is not a reason to take the app down.
 */
export function getApplicationLimits(): RiotKeyLimits {
  const fallback: RiotKeyLimits = {
    burstLimit: APPLICATION_KEY_LIMITS.burstLimit,
    sustainedLimit: APPLICATION_KEY_LIMITS.sustainedLimit
  }

  const raw = getSetting(getDb(), LIMITS_SETTING)
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as Partial<RiotKeyLimits>
    return {
      burstLimit: positiveOr(parsed.burstLimit, fallback.burstLimit),
      sustainedLimit: positiveOr(parsed.sustainedLimit, fallback.sustainedLimit)
    }
  } catch {
    return fallback
  }
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * Points the shared limiter at the allowance the saved key actually has.
 *
 * The windows come from the presets and are not editable: Riot states personal
 * limits per second and per two minutes, and application limits per ten seconds
 * and per ten minutes, and pacing against a window Riot does not measure would
 * be pacing against nothing.
 */
export function applyRateLimits(): void {
  if (getKeyType() !== 'application') {
    rateLimiter.updateConfig(PERSONAL_KEY_LIMITS)
    return
  }

  const limits = getApplicationLimits()
  rateLimiter.updateConfig({
    ...APPLICATION_KEY_LIMITS,
    burstLimit: limits.burstLimit,
    sustainedLimit: limits.sustainedLimit
  })
}

export function setKeyType(keyType: RiotKeyType, limits?: RiotKeyLimits): AppSettingsPublic {
  const db = getDb()
  setSetting(db, KEY_TYPE_SETTING, keyType)
  if (limits) {
    setSetting(
      db,
      LIMITS_SETTING,
      JSON.stringify({
        burstLimit: positiveOr(limits.burstLimit, APPLICATION_KEY_LIMITS.burstLimit),
        sustainedLimit: positiveOr(limits.sustainedLimit, APPLICATION_KEY_LIMITS.sustainedLimit)
      })
    )
  }

  applyRateLimits()
  log.info('Riot key type changed', { keyType })
  return getSettings()
}

export function getSettings(): AppSettingsPublic {
  const home = getHomeAccount(getDb())
  return {
    hasApiKey: loadApiKey() !== null,
    homeAccountId: home?.id ?? null,
    keyRejected: rateLimiter.keyRejected,
    keyType: getKeyType(),
    applicationLimits: getApplicationLimits()
  }
}

export interface ValidateResult {
  ok: boolean
  message?: string
  /**
   * How each tracked account fared when it was re-resolved under the new key.
   * Absent when the key did not actually change, or when the re-resolve could
   * not be attempted.
   */
  identities?: IdentityReport[]
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
      return { ok: false, message: rejectionMessage() }
    }
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reach Riot' }
  }

  saveApiKey(trimmed)
  if (trimmed === previous) return { ok: true }

  // A different key means different puuids — Riot encrypts them per key. Doing
  // this now rather than leaving it to the next sync to trip over means the
  // accounts are already re-linked by the time the user leaves this screen.
  //
  // Never fatal. The key is saved and Riot has just accepted it; a re-resolve
  // that could not be completed is retried by the sync that needs it, and
  // refusing a good key over it would be the worse failure by far.
  try {
    return { ok: true, identities: await repairAllIdentities() }
  } catch (err) {
    log.error('Could not re-resolve accounts after the key changed', err)
    return { ok: true }
  }
}

function rejectionMessage(): string {
  return getKeyType() === 'application'
    ? 'Riot rejected this key. Check it was copied whole, and that the application it belongs to is still approved.'
    : 'Riot rejected this key. Personal keys expire every 24h — grab a fresh one.'
}

export function removeApiKey(): void {
  clearApiKey()
  applyApiKey(null)
}
