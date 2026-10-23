import { GAMES, type GameId } from '@foxfire/core'
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
 *
 * Each game has its own schedule, in the registry: TFT's is longer, because
 * Riot publishes a TFT match only once the whole lobby is done, which can be
 * twenty minutes after the player was knocked out.
 */
const retryDelays = (game: GameId): readonly number[] => GAMES[game].postGameRetryMs

/** Per account and per game: a League game and a TFT one ending close together are two searches. */
const pending = new Map<string, NodeJS.Timeout>()

const pendingKey = (accountId: number, game: GameId): string => `${accountId}:${game}`

function clearPending(key: string): void {
  const timer = pending.get(key)
  if (timer) {
    clearTimeout(timer)
    pending.delete(key)
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
export function schedulePostGameSync(accountId: number, game: GameId = 'lol'): void {
  clearPending(pendingKey(accountId, game))
  log.info('Scheduling post-game sync', { accountId, game, attempts: retryDelays(game).length })
  scheduleAttempt(accountId, game, 0)
}

function scheduleAttempt(accountId: number, game: GameId, index: number): void {
  const key = pendingKey(accountId, game)
  const delays = retryDelays(game)

  if (index >= delays.length) {
    log.debug('Post-game sync gave up; match never appeared', { accountId, game })
    pending.delete(key)
    return
  }

  const timer = setTimeout(() => {
    pending.delete(key)
    void attempt(accountId, game, index)
  }, delays[index])

  // Nothing should be kept alive purely to wait for a match. In tray mode the
  // LCU watcher already holds the process open, and if the app is quitting the
  // launch sweep will find the game next time.
  timer.unref?.()
  pending.set(key, timer)
}

async function attempt(accountId: number, game: GameId, index: number): Promise<void> {
  try {
    const { stored } = await syncAccount(accountId, 'auto', game)
    if (stored > 0) {
      log.info('Post-game sync stored new matches', { accountId, game, stored, attempt: index + 1 })
      // Nothing to do about the recording here: every completed sync binds what
      // it can before returning, so the match that just landed has already been
      // offered to whatever was waiting for it.
      return
    }
  } catch (err) {
    // An expired or rejected key fails every remaining attempt too — the rate
    // limiter latches paused until a new one is saved — so stop rather than
    // spending four more requests proving it.
    if (err instanceof RiotApiError && err.isKeyRejection) {
      log.debug('Post-game sync abandoned: Riot rejected the API key', { accountId, game })
      return
    }
    log.debug('Post-game sync attempt failed', {
      accountId,
      game,
      attempt: index + 1,
      error: String(err)
    })
  }

  scheduleAttempt(accountId, game, index + 1)
}

/** Drops every pending schedule. Called on quit so no timer outlives the app. */
export function cancelAllPostGameSyncs(): void {
  for (const key of [...pending.keys()]) clearPending(key)
}
