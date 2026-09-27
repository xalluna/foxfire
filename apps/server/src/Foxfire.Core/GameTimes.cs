namespace Foxfire.Core;

/// <summary>
/// When a game counts as over, for everything that places a game among rank
/// readings.
///
/// A port of packages/core/src/rules/gameEnd.ts. A reading only knows a game's
/// result once the game has ended, so this is where attribution puts a game —
/// and where a hand-entered "after" rank is stored, so that it closes its own
/// game's interval and opens the next. The two have to be one instant, which is
/// why neither does the arithmetic itself.
///
/// It used to be the game's creation. A reading taken while the game was still
/// being played — a sync that ran mid-game, a desktop opening mid-game — shows
/// the rank the player went in with, but landed after the creation and so closed
/// the game's interval with no result in it. The game read 0 LP, or the previous
/// game's movement, depending on what was on the other side.
///
/// Not quite the true end: Riot counts the duration from when the game started
/// rather than from its creation, so this falls short by the loading screen, and
/// a reading taken in that last stretch is still placed after the game.
/// </summary>
public static class GameTimes
{
    /// <summary>
    /// Epoch milliseconds. The duration is seconds, as match-v5 has reported it
    /// since patch 11.20 — unlike every other time in this schema.
    /// </summary>
    public static long End(long gameCreation, int gameDurationSeconds) =>
        gameCreation + (gameDurationSeconds * 1000L);
}
