/**
 * The League client's gameflow phase machine, reduced to the one question this
 * app asks of it: did a game just finish?
 *
 * Kept apart from watcher.ts, and free of Electron and the database, so the
 * transition rule can be tested directly — it is the piece most likely to be
 * wrong, and the hardest to exercise by hand since reproducing it means playing
 * a real game.
 */

/** Phases during which the player is in a game that has not yet concluded. */
const PLAYING_PHASES = ['InProgress', 'Reconnect'] as const

/**
 * Phases the client passes through once a game has actually concluded.
 *
 * All three are listed because which ones appear, and for how long, varies:
 * WaitingForStats can be skipped entirely on a fast server, and a client closed
 * at the victory screen may never reach EndOfGame at all.
 */
const END_PHASES = ['WaitingForStats', 'PreEndOfGame', 'EndOfGame'] as const

export function isPlayingPhase(phase: string | null): boolean {
  return phase !== null && (PLAYING_PHASES as readonly string[]).includes(phase)
}

function isEndPhase(phase: string | null): boolean {
  return phase !== null && (END_PHASES as readonly string[]).includes(phase)
}

/**
 * Whether this phase change means a game just ended.
 *
 * Defined as *entering* an end phase from a playing one, rather than the more
 * obvious "left InProgress". Two reasons:
 *
 * - Reconnect counts as playing. A client that drops and rejoins goes
 *   InProgress → Reconnect → InProgress, which the naive rule would read as two
 *   finished games, syncing mid-match for nothing.
 * - Passing through several end phases in a row must fire once, not three
 *   times. Only the first crosses from a playing phase, so the later hops are
 *   inert.
 */
export function isGameEndTransition(previous: string | null, next: string | null): boolean {
  return isPlayingPhase(previous) && isEndPhase(next)
}

/**
 * Phases during which an upload should leave the connection alone.
 *
 * From champ select until the game has finished reporting: a two-gigabyte
 * upload competing with the game for somebody's upstream is lag they would
 * blame on the game. Champ select counts because the game starts from it with
 * no phase in between long enough to notice, and the end phases count because
 * the client is still sending the game's stats.
 */
const UPLOAD_QUIET_PHASES = [
  'ChampSelect',
  'GameStart',
  'InProgress',
  'Reconnect',
  'WaitingForStats',
  'PreEndOfGame'
] as const

export function isUploadQuietPhase(phase: string | null): boolean {
  return phase !== null && (UPLOAD_QUIET_PHASES as readonly string[]).includes(phase)
}
