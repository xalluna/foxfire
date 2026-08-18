/**
 * Deciding when a game is actually live, rather than still loading.
 *
 * The Live Client Data API starts answering before the game begins. Through the
 * loading screen it serves a full payload — the roster is already there — and
 * recording on the first successful response captured the loading screen and
 * took a time offset from a clock that had not started. Measured on a real
 * ARAM: 243 seconds of loading screen in front of an 1172-second game, with
 * every timeline marker four minutes early.
 *
 * The first attempt at this waited for `gameData.gameTime` to advance, and
 * nothing recorded at all. That value is optional in the payload and the mapper
 * defaults it to 0, so a game that does not report it leaves the clock reading
 * zero forever and the recording never starts — a silent, total failure, where
 * the bug it replaced merely misplaced the markers.
 *
 * So readiness now rests on two independent signals, either of which is enough,
 * plus a long backstop. The principle: footage with a questionable offset can
 * be repaired afterwards, and footage never captured cannot. Never wait
 * forever on one reading.
 */

/**
 * How much the clock must advance between two polls to count as running.
 *
 * The poll is two seconds, so a live game advances by about that much. Half a
 * second is clear of jitter in a frozen reading and well below a real tick.
 */
export const CLOCK_ADVANCE_S = 0.5

/**
 * How long the game may answer with neither signal before recording anyway.
 *
 * Longer than the longest loading screen actually observed (243 seconds), so
 * this only fires when something is genuinely wrong with both signals rather
 * than during an ordinary slow load. When it does fire the offset may be wrong,
 * which is recoverable; missing the game is not.
 */
export const READY_FALLBACK_MS = 6 * 60 * 1000

/** Why recording started, so the log says which signal was trusted. */
export type Readiness = 'wait' | 'clock' | 'event' | 'fallback'

export interface ReadinessInput {
  /** The previous poll's game clock, or null on the first reading of a game. */
  previousGameTime: number | null
  gameTime: number
  /** Whether the game's own event feed has reported GameStart. */
  sawGameStart: boolean
  /** How long the API has been answering for this game. */
  answeringForMs: number
}

export function gameReadiness(input: ReadinessInput): Readiness {
  // Preferred, because it is the game's own explicit statement that play has
  // begun, rather than something inferred from a number that may not be there.
  if (input.sawGameStart) return 'event'

  if (
    input.previousGameTime !== null &&
    input.gameTime - input.previousGameTime >= CLOCK_ADVANCE_S
  ) {
    return 'clock'
  }

  if (input.answeringForMs >= READY_FALLBACK_MS) return 'fallback'

  return 'wait'
}

/**
 * Whether the game clock is running, kept for the readiness check above.
 *
 * Needs two readings, so the first poll of a game never starts a recording on
 * its own.
 */
export function isClockRunning(previous: number | null, current: number): boolean {
  if (previous === null) return false
  return current - previous >= CLOCK_ADVANCE_S
}

/** The game's own "play has begun" event, by name and by its fixed id. */
export function containsGameStart(
  events: ReadonlyArray<{ EventName?: string | null; EventID?: number | null }>
): boolean {
  return events.some((event) => event.EventName === 'GameStart' || event.EventID === 0)
}
