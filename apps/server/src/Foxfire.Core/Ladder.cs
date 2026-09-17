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
    /// <summary>Riot's tier name, e.g. GOLD. Null when unranked.</summary>
    string? Tier { get; }

    /// <summary>Roman division, e.g. "II". Null or "I" in the apex tiers.</summary>
    string? Division { get; }

    int? LeaguePoints { get; }
}

/// <summary>A bare rank, for callers that have no snapshot to hand.</summary>
public sealed record Rank(string? Tier, string? Division, int? LeaguePoints) : IRank;

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
/// </summary>
public static class Ladder
{
    /// <summary>Tiers with four divisions each, lowest first.</summary>
    public static readonly IReadOnlyList<string> DivisionedTiers =
        ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];

    /// <summary>
    /// Master, Grandmaster and Challenger, which are decided by ladder cutoffs
    /// rather than LP thresholds.
    ///
    /// A 500 LP Master and a 500 LP Grandmaster are at the same point on the
    /// ladder, so the three share one scale and the name only drives colour and
    /// crest art — never the position.
    /// </summary>
    public static readonly IReadOnlyList<string> ApexTiers = ["MASTER", "GRANDMASTER", "CHALLENGER"];

    /// <summary>Lowest to highest, for comparing two ranks.</summary>
    public static readonly IReadOnlyList<string> AllTiers = [.. DivisionedTiers, .. ApexTiers];

    /// <summary>Roman division suffixes, lowest first.</summary>
    public static readonly IReadOnlyList<string> Divisions = ["IV", "III", "II", "I"];

    private const int LpPerDivision = 100;
    private static readonly int LpPerTier = Divisions.Count * LpPerDivision;

    /// <summary>Ladder position of Master 0 LP, which is also Diamond I 100 LP.</summary>
    public static readonly int ApexBase = DivisionedTiers.Count * LpPerTier;

    public static bool IsApex(string? tier) =>
        tier is not null && ApexTiers.Contains(tier, StringComparer.Ordinal);

    /// <summary>
    /// One number for tier, division and LP, or null when unranked.
    ///
    /// Iron IV 0 LP is 0 and Diamond I 100 LP is <see cref="ApexBase"/>, so the
    /// divisioned tiers and the apex scale meet with neither gap nor overlap.
    /// </summary>
    public static int? LadderPosition(IRank rank)
    {
        ArgumentNullException.ThrowIfNull(rank);

        if (rank.Tier is null) return null;
        var lp = rank.LeaguePoints ?? 0;

        if (IsApex(rank.Tier)) return ApexBase + lp;

        var tierIndex = IndexOf(DivisionedTiers, rank.Tier);
        if (tierIndex < 0) return null;

        // Apex tiers always report division "I"; a divisioned tier must name a
        // real one, and a snapshot without one cannot be placed.
        var divisionIndex = IndexOf(Divisions, rank.Division);
        if (divisionIndex < 0) return null;

        return (tierIndex * LpPerTier) + (divisionIndex * LpPerDivision) + lp;
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
        if (clamped >= ApexBase) return new Rank("MASTER", "I", clamped - ApexBase);

        var tierIndex = clamped / LpPerTier;
        var withinTier = clamped - (tierIndex * LpPerTier);
        var divisionIndex = withinTier / LpPerDivision;

        return new Rank(
            DivisionedTiers[tierIndex],
            Divisions[divisionIndex],
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

        if (before.Tier is null || IsApex(before.Tier)) return null;

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

        if (before.Tier is null || after.Tier is null) return RankMovement.None;

        var beforeTier = IndexOf(AllTiers, before.Tier);
        var afterTier = IndexOf(AllTiers, after.Tier);
        if (beforeTier < 0 || afterTier < 0) return RankMovement.None;

        if (afterTier != beforeTier)
        {
            return afterTier > beforeTier ? RankMovement.Promotion : RankMovement.Demotion;
        }

        var beforeDivision = IndexOf(Divisions, before.Division);
        var afterDivision = IndexOf(Divisions, after.Division);
        if (beforeDivision < 0 || afterDivision < 0 || afterDivision == beforeDivision)
        {
            return RankMovement.None;
        }

        return afterDivision > beforeDivision ? RankMovement.Promotion : RankMovement.Demotion;
    }

    /// <summary>The tier a ladder position falls in, for colouring a graph's bands.</summary>
    public static string TierAtPosition(double position)
    {
        if (position >= ApexBase) return "MASTER";

        var index = (int)Math.Floor(position / LpPerTier);
        return DivisionedTiers[Math.Clamp(index, 0, DivisionedTiers.Count - 1)];
    }

    private static int IndexOf(IReadOnlyList<string> values, string? value)
    {
        if (value is null) return -1;

        for (var i = 0; i < values.Count; i++)
        {
            if (string.Equals(values[i], value, StringComparison.Ordinal)) return i;
        }

        return -1;
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
