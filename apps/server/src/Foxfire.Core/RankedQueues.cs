namespace Foxfire.Core;

/// <summary>
/// The queues that carry a ladder, in every game.
///
/// Append only. League's two were the whole list for sixteen releases; TFT's
/// three follow them. The stored spelling is <see cref="RankedQueues.RiotName"/>
/// and never the member's number, but every switch over this reads a reorder
/// as a change.
/// </summary>
public enum RankedQueue
{
    SoloDuo,
    Flex,
    Tft,
    TftDoubleUp,
    TftHyperRoll
}

/// <summary>
/// How a ladder measures somebody.
///
/// <see cref="Divisioned"/> is tier, division and LP, Iron IV to Challenger —
/// League's two, and TFT's Ranked and Double Up. <see cref="Rated"/> is Hyper
/// Roll's: a rating and a coloured tier the rating falls in, with no divisions
/// and no LP. A rated ladder's position is its rating; see <see cref="Ladders"/>.
/// </summary>
public enum LadderScale
{
    Divisioned,
    Rated
}

/// <summary>
/// Which ladder a game counts towards.
///
/// An enum rather than the raw strings the desktop passes around, because these
/// values cross a database, an HTTP boundary and a Riot payload, and a typo in
/// any of them would silently file a game against nothing.
///
/// The server's copy of packages/core/src/games/ladders.ts, held to it by
/// fixtures/game-registry.json.
/// </summary>
public static class RankedQueues
{
    /// <summary>
    /// Every ladder Foxfire tracks, League's first.
    ///
    /// Every game's. Something that means League's — League attribution,
    /// League's seasons — asks <see cref="Of"/> for them.
    /// </summary>
    public static readonly IReadOnlyList<RankedQueue> All =
        [RankedQueue.SoloDuo, RankedQueue.Flex, RankedQueue.Tft, RankedQueue.TftDoubleUp, RankedQueue.TftHyperRoll];

    /// <summary>One game's ladders, in picker order.</summary>
    public static IReadOnlyList<RankedQueue> Of(Game game) => [.. All.Where(q => q.Game() == game)];

    /// <summary>Riot's own name for a queue, which is what the database stores.</summary>
    public static string RiotName(this RankedQueue queue) => queue switch
    {
        RankedQueue.SoloDuo => "RANKED_SOLO_5x5",
        RankedQueue.Flex => "RANKED_FLEX_SR",
        RankedQueue.Tft => "RANKED_TFT",
        RankedQueue.TftDoubleUp => "RANKED_TFT_DOUBLE_UP",
        RankedQueue.TftHyperRoll => "RANKED_TFT_TURBO",
        _ => throw new ArgumentOutOfRangeException(nameof(queue))
    };

    /// <summary>The queue id whose matches move this ladder.</summary>
    public static int QueueId(this RankedQueue queue) => queue switch
    {
        RankedQueue.SoloDuo => 420,
        RankedQueue.Flex => 440,
        RankedQueue.Tft => 1100,
        RankedQueue.TftDoubleUp => 1160,
        RankedQueue.TftHyperRoll => 1130,
        _ => throw new ArgumentOutOfRangeException(nameof(queue))
    };

    /// <summary>The game whose ladder it is.</summary>
    public static Game Game(this RankedQueue queue) => queue switch
    {
        RankedQueue.SoloDuo or RankedQueue.Flex => Core.Game.Lol,
        RankedQueue.Tft or RankedQueue.TftDoubleUp or RankedQueue.TftHyperRoll => Core.Game.Tft,
        _ => throw new ArgumentOutOfRangeException(nameof(queue))
    };

    /// <summary>How the ladder measures somebody.</summary>
    public static LadderScale Scale(this RankedQueue queue) =>
        queue == RankedQueue.TftHyperRoll ? LadderScale.Rated : LadderScale.Divisioned;

    /// <summary>Whether the LP editor offers it. Only a ladder with LP can be typed.</summary>
    public static bool LpEditable(this RankedQueue queue) => queue.Scale() == LadderScale.Divisioned;

    /// <summary>
    /// How many places a game on it can finish in, for the placement spread.
    ///
    /// None for League, which is won or lost; four for Double Up, which is
    /// ranked by team; eight for the rest of TFT.
    /// </summary>
    public static int PlacementSlots(this RankedQueue queue) => queue switch
    {
        RankedQueue.SoloDuo or RankedQueue.Flex => 0,
        RankedQueue.TftDoubleUp => 4,
        RankedQueue.Tft or RankedQueue.TftHyperRoll => 8,
        _ => throw new ArgumentOutOfRangeException(nameof(queue))
    };

    /// <summary>The ladder a queue id moves, or null for an unranked queue.</summary>
    public static RankedQueue? FromQueueId(int? queueId) => queueId switch
    {
        420 => RankedQueue.SoloDuo,
        440 => RankedQueue.Flex,
        1100 => RankedQueue.Tft,
        1160 => RankedQueue.TftDoubleUp,
        1130 => RankedQueue.TftHyperRoll,
        _ => null
    };

    /// <summary>The ladder a stored queue type names, or null if it names none.</summary>
    public static RankedQueue? FromRiotName(string? riotName) => riotName switch
    {
        "RANKED_SOLO_5x5" => RankedQueue.SoloDuo,
        "RANKED_FLEX_SR" => RankedQueue.Flex,
        "RANKED_TFT" => RankedQueue.Tft,
        "RANKED_TFT_DOUBLE_UP" => RankedQueue.TftDoubleUp,
        "RANKED_TFT_TURBO" => RankedQueue.TftHyperRoll,
        _ => null
    };

    /// <summary>The ladder a stored queue type names, if it is one of this game's.</summary>
    public static RankedQueue? FromRiotName(string? riotName, Game game) =>
        FromRiotName(riotName) is { } queue && queue.Game() == game ? queue : null;

    public static bool IsRanked(int? queueId) => FromQueueId(queueId) is not null;
}
