/**
 * Telling a loaded game from a loading one.
 *
 * The Live Client Data API starts answering before the game begins. Through the
 * loading screen it serves a full payload — the roster is already there — with
 * `gameTime` pinned at approximately zero, and only starts counting once every
 * player has loaded in.
 *
 * Recording on the first successful response therefore captured the loading
 * screen and took an offset of ~0 from a clock that had not started. Measured
 * on a real ARAM: a 1415-second recording of an 1172-second game, so 243
 * seconds of loading screen in front of the footage and every timeline marker
 * four minutes early.
 *
 * Waiting for the clock to move fixes the offset and stops several minutes of
 * loading screen going into every file.
 */

/**
 * How much the clock must advance between two polls to count as running.
 *
 * The poll is two seconds, so a live game advances by about that much. Half a
 * second is well clear of the jitter in a frozen reading and well below a real
 * tick, and it cannot be satisfied by the small non-zero value the API reports
 * while loading — that value does not change at all.
 */
export const CLOCK_ADVANCE_S = 0.5

/**
 * Whether the game clock is actually running.
 *
 * Needs two readings, so the first poll of a game never starts a recording.
 * That costs one poll interval at the start of the footage and is what makes
 * the offset trustworthy.
 */
export function isClockRunning(previous: number | null, current: number): boolean {
  if (previous === null) return false
  return current - previous >= CLOCK_ADVANCE_S
}
