import type { TftAccess } from '@foxfire/core'

/**
 * Whether the key TFT is asked through can reach TFT, as last found out.
 *
 * A key registered for League alone answers every TFT endpoint with a 403, so
 * this is learnt rather than configured: by the first TFT call after launch or
 * after a key changes, and by every TFT call's outcome after that. 'unknown'
 * until then. The Riot API key settings say it, and a TFT sync reads it
 * before spending anything.
 *
 * A denial is asked about again after a while rather than believed forever:
 * Riot can grant a key TFT later, and an expired main key reads as a denial
 * until a League call says otherwise. The server's Sync/TftAccess.cs is the
 * same rule.
 */

const REPROBE_AFTER_MS = 10 * 60_000

let state: TftAccess = 'unknown'
let checkedAt = 0

export function tftAccess(): TftAccess {
  return state
}

export function recordTftAccess(next: Exclude<TftAccess, 'unknown'>, now = Date.now()): void {
  state = next
  checkedAt = now
}

/** Forgets what was learnt, for a key that has just changed. */
export function resetTftAccess(): void {
  state = 'unknown'
  checkedAt = 0
}

/** Whether TFT is worth asking: granted, never asked, or denied long enough ago to ask again. */
export function shouldTryTft(now = Date.now()): boolean {
  return state !== 'denied' || now - checkedAt >= REPROBE_AFTER_MS
}
