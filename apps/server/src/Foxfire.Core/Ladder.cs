namespace Foxfire.Core;

/// <summary>
/// Anything that names a place on the ranked ladder.
///
/// Note the rename from the desktop, which calls the division `rank` because
/// that is what Riot calls it — leaving expressions like `rank.rank` all through
/// the attribution code. It is a division; it is called one here.
/// </summary>
public interface IRank
{
    /// <summary>The tier. Null when unranked, or when Riot named one nobody knows.</summary>
    RankTier? Tier { get; }

    /// <summary>The division. Null or <see cref="RankDivision.I"/> in the apex tiers.</summary>
    RankDivision? Division { get; }

    int? LeaguePoints { get; }
}

/// <summary>A bare rank, for callers that have no snapshot to hand.</summary>
public sealed record Rank(RankTier? Tier, RankDivision? Division, int? LeaguePoints) : IRank;

/// <summary>Whether a step between two ranks crossed a boundary.</summary>
public enum RankMovement
{
    None,
    Promotion,
    Demotion
}

/// <summary>
/// Tier, division and LP folded onto one continuous number.
///
/// A port of the desktop's src/shared/ladder.ts, and the arithmetic every LP
/// figure in Foxfire is derived from. It exists because raw LP is discontinuous:
/// Gold III 95 to Gold II 12 reads as −83 and was a 17 point win, and a graph
/// drawn on raw LP resets to zero at every promotion.
///
/// One thing is deliberately not a faithful port. JavaScript's Math.round goes
/// to the nearest integer and breaks ties upward; .NET's Math.Round breaks ties
/// to the even neighbour. On a .5 they disagree — 16.5 is 17 there and 16 here —
/// so every rounding below is written as floor(x + 0.5) to keep the two
/// implementations answering identically. That is reachable: the division
/// arithmetic in <see cref="RankFromLeaguePoints"/> lands exactly on .5 whenever
/// the typed LP is 50 away from the starting position.
///
/// The desktop indexes parallel arrays of strings to get at a tier's position.
/// Here a tier below Master is its own index and a division is its own offset
/// inside one, because <see cref="RankTier"/> and <see cref="RankDivision"/> are
/// declared in ladder order — which is why that order is load-bearing.
/// </summary>
public static class Ladder
{
    private const int LpPerDivision = 100;
    private static readonly int LpPerTier = RankDivisions.All.Count * LpPerDivision;

    /// <summary>Ladder position of Master 0 LP, which is also Diamond I 100 LP.</summary>
    public static readonly int ApexBase = RankTiers.Divisioned.Count * LpPerTier;

    /// <summary>
    /// One number for tier, division and LP, or null when unranked.
    ///
    /// Iron IV 0 LP is 0 and Diamond I 100 LP is <see cref="ApexBase"/>, so the
    /// divisioned tiers and the apex scale meet with neither gap nor overlap.
    /// </summary>
    public static int? LadderPosition(IRank rank)
    {
        ArgumentNullException.ThrowIfNull(rank);

        if (rank.Tier is not { } tier) return null;
        var lp = rank.LeaguePoints ?? 0;

        if (tier.IsApex()) return ApexBase + lp;

        // Apex tiers always report division "I"; a divisioned tier must name a
        // real one, and a snapshot without one cannot be placed.
        if (rank.Division is not { } division) return null;

        return ((int)tier * LpPerTier) + ((int)division * LpPerDivision) + lp;
    }

    /// <summary>
    /// The inverse of <see cref="LadderPosition"/>.
    ///
    /// Apex positions all come back as MASTER: which of the three a position
    /// really is depends on where the server's cutoffs happen to sit that day,
    /// and cannot be recovered from LP alone.
    /// </summary>
    public static Rank RankAtPosition(double position)
    {
        var clamped = Math.Max(0, RoundHalfUp(position));
        if (clamped >= ApexBase) return new Rank(RankTier.Master, RankDivision.I, clamped - ApexBase);

        var tierIndex = clamped / LpPerTier;
        var withinTier = clamped - (tierIndex * LpPerTier);
        var divisionIndex = withinTier / LpPerDivision;

        return new Rank(
            RankTiers.Divisioned[tierIndex],
            RankDivisions.All[divisionIndex],
            withinTier - (divisionIndex * LpPerDivision));
    }

    /// <summary>
    /// Where a bare LP figure most likely places somebody, given where they were.
    ///
    /// Typing a full rank for every game is three controls of mostly redundant
    /// work: the tier and division are almost always unchanged or one step away,
    /// and the LP number itself decides which. Every divisioned rank sits at
    /// k × 100 + lp for some whole k, so the candidates are fixed and the right
    /// one is the nearest — a game moves 15 to 30 LP, never the 100-plus that
    /// picking the wrong division would imply.
    ///
    /// Null when it cannot help: an unplaceable starting rank, or an apex one,
    /// where LP runs past 100 unbounded and 75 means 75 rather than a division
    /// boundary away.
    /// </summary>
    public static Rank? RankFromLeaguePoints(IRank before, int leaguePoints)
    {
        ArgumentNullException.ThrowIfNull(before);

        if (before.Tier is not { } tier || tier.IsApex()) return null;

        var from = LadderPosition(before);
        if (from is null) return null;

        // Iron IV 88 from Iron IV 5 is a real, if unusual, 83 point jump. There
        // is nothing below Iron IV for it to have come from, so the clamp keeps
        // it there rather than inventing a division that does not exist.
        var divisions = Math.Max(0, RoundHalfUp((from.Value - leaguePoints) / (double)LpPerDivision));
        return RankAtPosition((divisions * LpPerDivision) + leaguePoints);
    }

    /// <summary>
    /// Whether the step between two ranks crossed a tier or division boundary.
    ///
    /// Compares tier and division rather than ladder position, so gaining LP
    /// inside a division is not a movement — and so Master to Grandmaster still
    /// registers as a promotion even though the two share a position.
    /// </summary>
    public static RankMovement Movement(IRank before, IRank after)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);

        if (before.Tier is not { } beforeTier || after.Tier is not { } afterTier) return RankMovement.None;

        if (afterTier != beforeTier)
        {
            return afterTier > beforeTier ? RankMovement.Promotion : RankMovement.Demotion;
        }

        if (before.Division is not { } beforeDivision
            || after.Division is not { } afterDivision
            || afterDivision == beforeDivision)
        {
            return RankMovement.None;
        }

        return afterDivision > beforeDivision ? RankMovement.Promotion : RankMovement.Demotion;
    }

    /// <summary>The tier a ladder position falls in, for colouring a graph's bands.</summary>
    public static RankTier TierAtPosition(double position)
    {
        if (position >= ApexBase) return RankTier.Master;

        var index = (int)Math.Floor(position / LpPerTier);
        return RankTiers.Divisioned[Math.Clamp(index, 0, RankTiers.Divisioned.Count - 1)];
    }

    /// <summary>
    /// JavaScript's Math.round, which is not .NET's.
    ///
    /// .NET rounds a tie to the even neighbour; JavaScript rounds it up. Both
    /// implementations of this ladder have to agree to the LP, so this is the
    /// one the desktop already shipped.
    /// </summary>
    private static int RoundHalfUp(double value) => (int)Math.Floor(value + 0.5);
}
