import { RiotApiError } from '../riot/rateLimiter'
import { createLogger } from '../telemetry/logger'
import { syncAccount } from './syncService'

const log = createLogger('postGameSync')

/**
 * When to look for the game that just ended.
 *
 * Riot does not publish a match to match-v5 the moment it ends — the client
 * reaches its end-of-game screen well before the API will list the game, and
 * how long that takes varies. A single attempt fired on the end-of-game signal
 * therefore usually finds nothing, which is exactly the failure this whole
 * feature exists to remove: it would look fixed most evenings and broken on the
 * rest.
 *
 * So it retries on a widening schedule until the match lands. A delta sync is
 * two requests plus one per genuinely new match, against a budget of 100 per
 * two minutes, so the cost of being patient here is negligible. The last
 * attempt sits at ten minutes because a match that has not appeared by then is
 * not going to be caught by trying once more — the launch sweep will get it.
 */
const RETRY_DELAYS_MS = [30_000, 90_000, 180_000, 360_000, 600_000]

const pending = new Map<number, NodeJS.Timeout>()

function clearPending(accountId: number): void {
  const timer = pending.get(accountId)
  if (timer) {
    clearTimeout(timer)
    pending.delete(accountId)
  }
}

/**
 * Looks for a newly finished game, retrying until it appears.
 *
 * Replaces any schedule already pending for the account rather than running two
 * in parallel: back-to-back games are the normal case, and the later game's
 * schedule subsumes the earlier one — a delta sync fetches everything new, so
 * the first game is picked up by the second game's attempts anyway.
 */
export function schedulePostGameSync(accountId: number): void {
  clearPending(accountId)
  log.info('Scheduling post-game sync', { accountId, attempts: RETRY_DELAYS_MS.length })
  scheduleAttempt(accountId, 0)
}

function scheduleAttempt(accountId: number, index: number): void {
  if (index >= RETRY_DELAYS_MS.length) {
    log.debug('Post-game sync gave up; match never appeared', { accountId })
    pending.delete(accountId)
    return
  }

  const timer = setTimeout(() => {
    pending.delete(accountId)
    void attempt(accountId, index)
  }, RETRY_DELAYS_MS[index])

  // Nothing should be kept alive purely to wait for a match. In tray mode the
  // LCU watcher already holds the process open, and if the app is quitting the
  // launch sweep will find the game next time.
  timer.unref?.()
  pending.set(accountId, timer)
}

async function attempt(accountId: number, index: number): Promise<void> {
  try {
    const { stored } = await syncAccount(accountId, 'auto')
    if (stored > 0) {
      log.info('Post-game sync stored new matches', { accountId, stored, attempt: index + 1 })
      return
    }
  } catch (err) {
    // An expired or rejected key fails every remaining attempt too — the rate
    // limiter latches paused until a new one is saved — so stop rather than
    // spending four more requests proving it.
    if (err instanceof RiotApiError && (err.status === 401 || err.status === 403)) {
      log.debug('Post-game sync abandoned: Riot rejected the API key', { accountId })
      return
    }
    log.debug('Post-game sync attempt failed', {
      accountId,
      attempt: index + 1,
      error: String(err)
    })
  }

  scheduleAttempt(accountId, index + 1)
}

/** Drops every pending schedule. Called on quit so no timer outlives the app. */
export function cancelAllPostGameSyncs(): void {
  for (const accountId of [...pending.keys()]) clearPending(accountId)
}
