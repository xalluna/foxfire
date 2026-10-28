/**
 * The League client's gameflow phase machine, reduced to the one question this
 * app asks of it: did a game just finish?
 *
 * Kept apart from watcher.ts, and free of Electron and the database, so the
 * transition rule can be tested directly — it is the piece most likely to be
 * wrong, and the hardest to exercise by hand since reproducing it means playing
 * a real game.
 */

import type { GameId } from '@foxfire/core'

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
 *
 * TFT ends sooner for the player than for the lobby. Knocked out, they can
 * leave with "Exit now" while seven others play on, and the client need not
 * walk the end phases League's games do on the way back — so for TFT, leaving
 * a playing phase for anything but another one is the end. A TFT game left
 * any other way has nothing in it left to wait for either: the player's LP
 * moved when they went out.
 */
export function isGameEndTransition(previous: string | null, next: string | null, game: GameId = 'lol'): boolean {
  if (!isPlayingPhase(previous)) return false
  if (game === 'tft') return next !== null && !isPlayingPhase(next)
  return isEndPhase(next)
}

/**
 * Phases from which a game is about to start: in queue, accepting, picking,
 * launching. TFT has no champion select and goes straight from the ready check
 * to the game, so the queue itself counts.
 *
 * The client moves on to InProgress as the game launches — the start of the
 * loading screen — and capture arms on that. Only noticed at the watcher's own
 * pace, it could be ten seconds late, which a quick loading screen does not
 * outlast: the game was already being played before capture knew about it.
 */
const PRE_GAME_PHASES = ['Matchmaking', 'ReadyCheck', 'ChampSelect', 'GameStart'] as const

export function isPreGamePhase(phase: string | null): boolean {
  return phase !== null && (PRE_GAME_PHASES as readonly string[]).includes(phase)
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
