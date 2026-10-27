import { getDb } from '../db'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { getHomeAccount } from '../db/repositories/accounts.repo'
import { getSetting, setSetting } from '../db/repositories/appSettings.repo'
import type { RiotKeyScope } from '@foxfire/core'
import { APPLICATION_KEY_LIMITS, PERSONAL_KEY_LIMITS, RiotApiError } from '../riot/rateLimiter'
import {
  setApiKey as applyApiKey,
  setTftApiKey as applyTftApiKey,
  hasTftApiKey,
  mainScope,
  rateLimiter,
  tftScope
} from '../riot/client'
import { checkPlatformStatus } from '../riot/endpoints/status'
import { probeTftAccess } from '../riot/endpoints/tftStatus'
import { DEFAULT_PLATFORM } from '../riot/regions'
import { clearApiKey, clearSecret, loadApiKey, loadSecret, saveApiKey, saveSecret } from '../security/keyStore'
import { createLogger } from '../telemetry/logger'
import { repairAllIdentities } from './identityService'
import { recordTftAccess, resetTftAccess, tftAccess } from './tftAccess'
import { forgetTftIdentities } from './tftIdentity'
import type { AppSettingsPublic, IdentityReport, RiotKeyLimits, RiotKeyType } from '@shared/types'

const log = createLogger('settings')

/** Where each key's type and allowance are kept: the main key's as they always were, TFT's beside them. */
const KEY_TYPE_SETTING: Record<RiotKeyScope, string> = { main: 'riot.keyType', tft: 'riot.tft.keyType' }
const LIMITS_SETTING: Record<RiotKeyScope, string> = { main: 'riot.limits', tft: 'riot.tft.limits' }

/**
 * The TFT key, in the secret store beside the main one and never in the
 * database, for the same reason: the database is a file people copy.
 */
const TFT_KEY_SECRET = 'riot-tft-api-key'

/** Loads any previously stored keys into the Riot client at startup. */
export function initSettings(): void {
  const key = loadApiKey()
  if (key) applyApiKey(key)

  const tftKey = loadSecret(TFT_KEY_SECRET)
  if (tftKey) applyTftApiKey(tftKey)

  applyRateLimits()

  // Personal keys expire every 24h; tell the renderer so it can prompt for a
  // fresh one instead of leaving the user staring at failed lookups.
  rateLimiter.on('key-invalid', () => {
    broadcast(CH.settings.keyInvalid)
  })
}

export function getKeyType(scope: RiotKeyScope = 'main'): RiotKeyType {
  return getSetting(getDb(), KEY_TYPE_SETTING[scope]) === 'application' ? 'application' : 'personal'
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
export function getApplicationLimits(scope: RiotKeyScope = 'main'): RiotKeyLimits {
  const fallback: RiotKeyLimits = {
    burstLimit: APPLICATION_KEY_LIMITS.burstLimit,
    sustainedLimit: APPLICATION_KEY_LIMITS.sustainedLimit
  }

  const raw = getSetting(getDb(), LIMITS_SETTING[scope])
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
 * Points each key's limiter at the allowance that key actually has.
 *
 * The windows come from the presets and are not editable: Riot states personal
 * limits per second and per two minutes, and application limits per ten seconds
 * and per ten minutes, and pacing against a window Riot does not measure would
 * be pacing against nothing.
 */
export function applyRateLimits(): void {
  for (const scope of [mainScope, tftScope]) {
    if (getKeyType(scope.name) !== 'application') {
      scope.limiter.updateConfig(PERSONAL_KEY_LIMITS)
      continue
    }

    const limits = getApplicationLimits(scope.name)
    scope.limiter.updateConfig({
      ...APPLICATION_KEY_LIMITS,
      burstLimit: limits.burstLimit,
      sustainedLimit: limits.sustainedLimit
    })
  }
}

export function setKeyType(
  keyType: RiotKeyType,
  limits?: RiotKeyLimits,
  scope: RiotKeyScope = 'main'
): AppSettingsPublic {
  const db = getDb()
  setSetting(db, KEY_TYPE_SETTING[scope], keyType)
  if (limits) {
    setSetting(
      db,
      LIMITS_SETTING[scope],
      JSON.stringify({
        burstLimit: positiveOr(limits.burstLimit, APPLICATION_KEY_LIMITS.burstLimit),
        sustainedLimit: positiveOr(limits.sustainedLimit, APPLICATION_KEY_LIMITS.sustainedLimit)
      })
    )
  }

  applyRateLimits()
  log.info('Riot key type changed', { keyType, scope })
  return getSettings()
}

export function getSettings(): AppSettingsPublic {
  const home = getHomeAccount(getDb())
  return {
    hasApiKey: loadApiKey() !== null,
    homeAccountId: home?.id ?? null,
    keyRejected: rateLimiter.keyRejected,
    keyType: getKeyType(),
    applicationLimits: getApplicationLimits(),
    hasTftApiKey: loadSecret(TFT_KEY_SECRET) !== null,
    tftKeyRejected: tftScope.limiter.keyRejected,
    tftKeyType: getKeyType('tft'),
    tftApplicationLimits: getApplicationLimits('tft'),
    tftAccess: tftAccess()
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

  // TFT asks through this key when it has none of its own, and a new key can
  // have been granted TFT where the old one was not, or the other way round.
  if (!hasTftApiKey()) resetTftAccess()

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

/**
 * Gives TFT a key of its own, checked against TFT before it is kept.
 *
 * Optional: without one TFT asks through the main key, which works whenever
 * that key was granted TFT. A key of its own is for when it was not, or for a
 * budget TFT's backfill does not share with League's.
 */
export async function setAndValidateTftApiKey(key: string): Promise<ValidateResult> {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, message: 'Key cannot be empty' }

  const previous = loadSecret(TFT_KEY_SECRET)
  applyTftApiKey(trimmed)

  let access: Awaited<ReturnType<typeof probeTftAccess>>
  try {
    access = await probeTftAccess(DEFAULT_PLATFORM)
  } catch (err) {
    putTftApiKey(previous)
    if (err instanceof RiotApiError && err.isKeyRejection) {
      return { ok: false, message: 'Riot rejected this key. Check it was copied whole, and that it has not expired.' }
    }
    return { ok: false, message: err instanceof Error ? err.message : 'Could not reach Riot' }
  }

  if (access === 'denied') {
    putTftApiKey(previous)
    return { ok: false, message: 'Riot will not let this key reach TFT. Use a key registered for Teamfight Tactics.' }
  }

  saveSecret(TFT_KEY_SECRET, trimmed)
  recordTftAccess('granted')
  if (trimmed !== previous) onTftKeyChanged()
  log.info('TFT has a key of its own')
  return { ok: true }
}

/**
 * TFT's own key from here on, or none — what a paste that did not take puts
 * back, and what removing the key leaves.
 *
 * With none, also clears whatever a refusal latched on TFT's queue: a queue
 * with no key has nothing to have been refused, and left latched it would read
 * as a rejected TFT key in Settings with no key there.
 */
function putTftApiKey(key: string | null): void {
  applyTftApiKey(key)
  if (key === null) tftScope.limiter.resume()
}

/** Takes TFT's own key away; TFT goes back to asking through the main key. */
export function removeTftApiKey(): void {
  clearSecret(TFT_KEY_SECRET)
  putTftApiKey(null)
  onTftKeyChanged()
  log.info('TFT is back on the main key')
}

/**
 * A different key means TFT knows every account by a different id, and
 * whether TFT can be reached at all is a question to ask again.
 */
function onTftKeyChanged(): void {
  resetTftAccess()
  forgetTftIdentities(getDb())
}
