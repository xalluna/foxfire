namespace Foxfire.Core;

/// <summary>
/// One reading of somebody's rank at a moment.
/// </summary>
/// <param name="CapturedAt">
/// Epoch milliseconds, so it compares directly against a match's gameCreation.
/// </param>
/// <param name="LadderPosition">
/// Stamped on write from tier, division and LP. Null when the reading was of an
/// unranked account, which is why an interval touching one is never attributed.
/// </param>
public sealed record RankSnapshot(
    RankedQueue Queue,
    string? Tier,
    string? Division,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    int? LadderPosition,
    string Source,
    long CapturedAt) : IRank;

/// <summary>A ranked game, as far as attribution cares.</summary>
/// <param name="GameCreation">Epoch milliseconds.</param>
/// <param name="QueueId">Which ladder it moved.</param>
/// <param name="EndedInEarlySurrender">
/// A remake. It costs no LP, so it must not be counted as the game that explains
/// an interval — and worse, must not make an otherwise unambiguous interval look
/// like it holds two.
/// </param>
public sealed record RankedMatch(
    string MatchId,
    long GameCreation,
    int QueueId,
    bool EndedInEarlySurrender);

/// <summary>What attribution decided a game was worth.</summary>
/// <param name="LpDelta">
/// A difference of ladder positions rather than of raw LP, so it stays correct
/// across a division or tier boundary where LP itself wraps back to near zero.
/// </param>
public sealed record MatchRankAttribution(
    string MatchId,
    RankedQueue Queue,
    string? TierBefore,
    string? DivisionBefore,
    int? LpBefore,
    string? TierAfter,
    string? DivisionAfter,
    int? LpAfter,
    int LpDelta,
    bool IsPromotion,
    bool IsDemotion);

/// <summary>
/// Assigning an LP change to a game, but only when it is unambiguous.
///
/// Riot publishes no per-match LP. All anybody can do is attribute the movement
/// between two readings of a rank, and that is only honest when exactly one
/// ranked game falls between them. When several do, the total could have been
/// split any number of ways, and nothing is written rather than spreading a
/// guess across games and presenting it as a measurement.
///
/// Ported from the desktop's src/main/services/rankAttribution.ts, which is the
/// specification: the same test cases run against this, because this is the one
/// piece of behaviour a user would notice going wrong immediately and could not
/// debug. The numbers on every match row come from here.
///
/// One structural difference from the original. There, the interval predicate
/// lives in SQL — `game_creation &gt; ? AND game_creation &lt;= ?` — and the
/// function reaches into the database itself. Here the candidate games are
/// passed in and the predicate is <see cref="InInterval"/>, which makes the
/// subtle part testable directly: the interval is exclusive below and inclusive
/// above, and getting that backwards would silently double-count the game on
/// every boundary.
/// </summary>
public static class RankAttribution
{
    /// <summary>
    /// What an interval says a game was worth, or null when it says nothing.
    ///
    /// Null is the ordinary answer and covers every reason at once: either
    /// reading was unranked, a ladder reset sits between them, or the interval
    /// holds anything other than exactly one ranked game.
    /// </summary>
    /// <param name="candidates">
    /// Games to consider. Filtered here by queue, by remake, and by the
    /// interval, so a caller may pass everything it has for the account.
    /// </param>
    public static MatchRankAttribution? Attribute(
        RankSnapshot before,
        RankSnapshot after,
        IReadOnlyList<RankedMatch> candidates,
        IReadOnlyList<Season> seasons)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);
        ArgumentNullException.ThrowIfNull(candidates);
        ArgumentNullException.ThrowIfNull(seasons);

        if (before.LadderPosition is null || after.LadderPosition is null) return null;

        // Never attribute across a ladder reset. The interval from a December
        // reading to the first January one contains the annual reset, and its
        // ladder delta is the entire height of the player's rank — roughly
        // −1,900 for a Diamond player. If a single ranked game happens to sit in
        // that interval it would be handed that number, and because attribution
        // is replayed unbounded on every pass, the figure comes back however
        // often it is cleared. The reset is not the result of any game, so no
        // game gets it.
        //
        // Keyed on the reset rather than on the boundary: a preseason carries
        // rank forward, and a game either side of a boundary that reset nothing
        // still earned its LP. With no seasons recorded the guard cannot fire,
        // which is the cost of the boundaries being hand-entered.
        if (RankedSeasons.ResetsBetween(seasons, before.CapturedAt, after.CapturedAt)) return null;

        var queue = before.Queue;
        var queueId = queue.QueueId();

        string? only = null;
        foreach (var match in candidates)
        {
            if (match.QueueId != queueId) continue;
            if (match.EndedInEarlySurrender) continue;
            if (!InInterval(match.GameCreation, before.CapturedAt, after.CapturedAt)) continue;

            // A second game makes the interval ambiguous, and nothing more can
            // change that — no need to keep counting.
            if (only is not null) return null;
            only = match.MatchId;
        }

        if (only is null) return null;

        var movement = Ladder.Movement(before, after);

        return new MatchRankAttribution(
            MatchId: only,
            Queue: queue,
            TierBefore: before.Tier,
            DivisionBefore: before.Division,
            LpBefore: before.LeaguePoints,
            TierAfter: after.Tier,
            DivisionAfter: after.Division,
            LpAfter: after.LeaguePoints,
            LpDelta: after.LadderPosition.Value - before.LadderPosition.Value,
            IsPromotion: movement == RankMovement.Promotion,
            IsDemotion: movement == RankMovement.Demotion);
    }

    /// <summary>
    /// Walks every adjacent pair of readings and attributes what it can.
    ///
    /// This replaying is the reason the LP figure works at all. Attribution used
    /// to happen once, inline, the moment a reading was written — which is about
    /// a minute after a game ends, and Riot does not publish the match for a
    /// couple of minutes after that. So the interval was always searched before
    /// the game it contained existed, found nothing, and was never revisited:
    /// the reading had already moved the boundary past the game, and a later
    /// sync storing the match changed no rank value, so nothing re-triggered.
    /// Every game came out unattributed.
    ///
    /// Replaying decouples the two arrival orders. Whichever lands second, the
    /// next pass closes the gap — which also backfills history recorded before
    /// any of this existed.
    ///
    /// There is no "already done" bookkeeping, and none is wanted: an interval
    /// is attributed only when it holds exactly one game, and writing the result
    /// is an upsert, so running this again can only ever add information.
    /// </summary>
    /// <param name="snapshots">
    /// One queue's readings, oldest first. Pairs are taken in the order given.
    /// </param>
    public static IReadOnlyList<MatchRankAttribution> Replay(
        IReadOnlyList<RankSnapshot> snapshots,
        IReadOnlyList<RankedMatch> candidates,
        IReadOnlyList<Season> seasons)
    {
        ArgumentNullException.ThrowIfNull(snapshots);

        List<MatchRankAttribution> attributed = [];

        for (var i = 1; i < snapshots.Count; i++)
        {
            var result = Attribute(snapshots[i - 1], snapshots[i], candidates, seasons);
            if (result is not null) attributed.Add(result);
        }

        return attributed;
    }

    /// <summary>
    /// Whether a game falls in the interval between two readings.
    ///
    /// Exclusive below, inclusive above. That asymmetry is the whole of it: a
    /// game whose creation is exactly a reading's timestamp belongs to the
    /// interval ending there and not to the one starting there, and treating
    /// either bound the other way would count it twice across adjacent pairs and
    /// make both of them ambiguous.
    /// </summary>
    public static bool InInterval(long gameCreation, long afterMs, long upToMs) =>
        gameCreation > afterMs && gameCreation <= upToMs;
}
