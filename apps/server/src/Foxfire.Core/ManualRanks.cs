namespace Foxfire.Core;

/// <summary>A rank somebody can type: a tier plus, below Master, a division and LP.</summary>
/// <param name="Division">Null for the apex tiers, which have no divisions.</param>
public sealed record ManualRank(string Tier, string? Division, int LeaguePoints) : IRank
{
    string? IRank.Tier => Tier;
    string? IRank.Division => Division;
    int? IRank.LeaguePoints => LeaguePoints;
}

/// <summary>
/// One hand-entered figure for one game.
///
/// <paramref name="Before"/> is the unusual half. Attribution needs a reading on
/// each side of a game, and for the first game a server ever saw — or one
/// following placements — there is nothing before it, so an "after" alone would
/// save and then produce nothing at all.
/// </summary>
public sealed record ManualRankEdit(string MatchId, ManualRank After, ManualRank? Before);

/// <summary>
/// Checking a typed rank before it becomes a row.
///
/// Worth doing at all because of how the failure looks otherwise:
/// <see cref="Ladder.LadderPosition"/> returns null for anything it cannot
/// place, and a reading with a null position is silently skipped by attribution.
/// So an unchecked bad value saves without error and then quietly does nothing,
/// which is the most confusing outcome available.
/// </summary>
public static class ManualRanks
{
    /// <summary>The problem with this rank, or null when there is none.</summary>
    public static string? Validate(ManualRank rank)
    {
        ArgumentNullException.ThrowIfNull(rank);

        if (!Ladder.AllTiers.Contains(rank.Tier, StringComparer.OrdinalIgnoreCase)) return "Pick a tier";

        if (Ladder.IsApex(rank.Tier))
        {
            // Master and above are ranked by ladder cutoffs, so LP runs past 100
            // with no divisions to cross.
            return rank.LeaguePoints < 0 ? "LP must be 0 or more" : null;
        }

        if (rank.Division is null || !Ladder.Divisions.Contains(rank.Division, StringComparer.OrdinalIgnoreCase))
        {
            return "Pick a division";
        }

        return rank.LeaguePoints is < 0 or > 99 ? "LP must be between 0 and 99" : null;
    }

    /// <summary>
    /// When an assertion is taken to have been true.
    ///
    /// Game end rather than game start, so it falls inside the interval for its
    /// own match and clear of the next one. Duration is seconds, unlike every
    /// other time in this schema.
    /// </summary>
    public static long AfterTime(long gameCreation, int gameDurationSeconds) =>
        gameCreation + (gameDurationSeconds * 1000L);

    /// <summary>
    /// A moment just before a game, for the entry that must state the rank going
    /// in as well as the one coming out.
    ///
    /// A millisecond is enough: the interval test is a strict greater-than, so
    /// the game still falls inside it.
    /// </summary>
    public static long BeforeTime(long gameCreation) => gameCreation - 1;

    /// <summary>
    /// The division to store for a typed rank.
    ///
    /// Apex tiers have no divisions, and Riot reports them as "I" — matched here
    /// so a hand-entered Master reading and an observed one are the same row.
    /// </summary>
    public static string? StoredDivision(ManualRank rank)
    {
        ArgumentNullException.ThrowIfNull(rank);
        return Ladder.IsApex(rank.Tier) ? "I" : rank.Division;
    }
}
