/**
 * The moment a game counts as over, for everything that places a game among
 * rank readings.
 *
 * A reading only knows a game's result once the game has ended, so this is
 * where LP attribution puts a game — in the interval between the reading before
 * this moment and the first one at or after it — and where a hand-entered
 * "after" rank is stored, so that it closes its own game's interval and opens
 * the next. Both have to be the same instant, which is why it lives here rather
 * than as arithmetic in each of them. The server's `GameTimes.End` is the port.
 *
 * It used to be the game's creation. A reading taken while the game was still
 * being played — a sync that ran mid-game, the app opening mid-game — shows the
 * rank the player went in with, but landed after the creation and so closed the
 * game's interval with no result in it. The game read 0 LP, or the previous
 * game's movement, depending on what was on the other side.
 *
 * Not quite the true end. Riot counts the duration from when the game started
 * rather than from its creation, so this falls short of the real end by the
 * loading screen. A reading taken in that last stretch of a game is still
 * placed after it — a far narrower window than the whole game used to be.
 *
 * `gameDuration` is seconds, as match-v5 has reported it since patch 11.20;
 * nothing older survives Riot's retention to be fetched.
 */
export function gameEndMs(gameCreation: number, gameDuration: number): number {
  return gameCreation + gameDuration * 1000
}
