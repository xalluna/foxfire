namespace Foxfire.Core;

/// <summary>
/// Hyper Roll's colours, lowest first.
///
/// The order is load-bearing for the same reason <see cref="RankTier"/>'s is: a
/// promotion is an integer comparison.
/// </summary>
public enum RatedTier
{
    Gray,
    Green,
    Blue,
    Purple,
    Orange
}

/// <summary>
/// Hyper Roll's ladder: a rating, and the coloured tier it falls in.
///
/// The server's copy of packages/core/src/rules/ratedLadder.ts. The floors only
/// colour a graph's bands — every reading carries its own tier — so they are
/// the one thing here allowed to go stale when Riot moves them.
/// </summary>
public static class RatedTiers
{
    /// <summary>Lowest to highest.</summary>
    public static readonly IReadOnlyList<RatedTier> All = [.. Enum.GetValues<RatedTier>()];

    /// <summary>Riot's own name for a tier, which is what the database stores.</summary>
    public static string RiotName(this RatedTier tier) => tier switch
    {
        RatedTier.Gray => "GRAY",
        RatedTier.Green => "GREEN",
        RatedTier.Blue => "BLUE",
        RatedTier.Purple => "PURPLE",
        RatedTier.Orange => "ORANGE",
        _ => throw new ArgumentOutOfRangeException(nameof(tier))
    };

    /// <summary>The rating each tier starts at.</summary>
    public static int Floor(this RatedTier tier) => tier switch
    {
        RatedTier.Gray => 0,
        RatedTier.Green => 1400,
        RatedTier.Blue => 2600,
        RatedTier.Purple => 3400,
        RatedTier.Orange => 4200,
        _ => throw new ArgumentOutOfRangeException(nameof(tier))
    };

    /// <summary>The tier a string names, or null. Total, as <see cref="RankTiers.FromRiotName"/> is, and for the same reasons.</summary>
    public static RatedTier? FromRiotName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return Exact(name) ?? Exact(name.Trim().ToUpperInvariant());
    }

    /// <summary>Whether the step between two rated readings changed colour.</summary>
    public static RankMovement Movement(RatedTier? before, RatedTier? after)
    {
        if (before is not { } from || after is not { } to || from == to) return RankMovement.None;
        return to > from ? RankMovement.Promotion : RankMovement.Demotion;
    }

    private static RatedTier? Exact(string name) => name switch
    {
        "GRAY" => RatedTier.Gray,
        "GREEN" => RatedTier.Green,
        "BLUE" => RatedTier.Blue,
        "PURPLE" => RatedTier.Purple,
        "ORANGE" => RatedTier.Orange,
        _ => null
    };
}

/// <summary>
/// Where a reading stands, on whichever kind of ladder.
///
/// A divisioned ladder folds tier, division and LP the way <see cref="Ladder"/>
/// always has. A rated one is its rating, which is already one number, so the
/// graph, the trend and attribution all work on it unchanged.
/// </summary>
public static class Ladders
{
    /// <summary>One number for a reading, or null for a reading of nobody.</summary>
    public static int? PositionOf(RankedQueue queue, IRank rank, int? ratedRating) =>
        queue.Scale() == LadderScale.Rated ? ratedRating : Ladder.LadderPosition(rank);

    /// <summary>Whether the step between two readings on one ladder crossed a boundary.</summary>
    public static RankMovement Movement(RankReading before, RankReading after)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);

        return before.Queue.Scale() == LadderScale.Rated
            ? RatedTiers.Movement(before.RatedTier, after.RatedTier)
            : Ladder.Movement(before, after);
    }
}
