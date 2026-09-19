namespace Foxfire.Core;

/// <summary>
/// A tier on the ranked ladder, lowest first.
///
/// The order is load-bearing. <see cref="Ladder.Movement"/> compares two of
/// these as integers to tell a promotion from a demotion, <see cref="Ladder"/>
/// uses a tier's own value as its index into the divisioned scale, and apex is
/// a comparison against <see cref="Master"/>. Reordering a member does not fail
/// to compile — it silently changes what counts as a climb.
///
/// Emerald sits where Riot put it in 2023, between Platinum and Diamond, and is
/// the reminder that this list is not closed. A tier this server has never
/// heard of is dealt with at the edges rather than here; see
/// <see cref="RankTiers.FromRiotName"/>.
/// </summary>
public enum RankTier
{
    Iron,
    Bronze,
    Silver,
    Gold,
    Platinum,
    Emerald,
    Diamond,
    Master,
    Grandmaster,
    Challenger
}

/// <summary>
/// The four steps inside a tier, lowest first — so IV is least and I is most.
///
/// Ascending like <see cref="RankTier"/> and for the same reason: the division
/// half of a promotion is an integer comparison, and a division's own value is
/// its offset inside a tier. Named as Riot writes them, because every surface a
/// person reads them on writes them that way too.
/// </summary>
public enum RankDivision
{
    IV,
    III,
    II,
    I
}

/// <summary>
/// Tiers, and the strings Riot spells them with.
///
/// The same arrangement as <see cref="RankedQueues"/>, for the same reason:
/// these values cross a database, an HTTP boundary and a Riot payload, and the
/// C# type is what stops a typo in any of them filing a rank against nothing.
///
/// Riot's spelling is the stored spelling, so this is a change of type and not
/// of data — every row already holds exactly what <see cref="RiotName"/>
/// returns.
/// </summary>
public static class RankTiers
{
    /// <summary>Tiers with four divisions each, lowest first.</summary>
    public static readonly IReadOnlyList<RankTier> Divisioned =
    [
        RankTier.Iron,
        RankTier.Bronze,
        RankTier.Silver,
        RankTier.Gold,
        RankTier.Platinum,
        RankTier.Emerald,
        RankTier.Diamond
    ];

    /// <summary>
    /// Master, Grandmaster and Challenger, which are decided by ladder cutoffs
    /// rather than LP thresholds.
    ///
    /// A 500 LP Master and a 500 LP Grandmaster are at the same point on the
    /// ladder, so the three share one scale and the name only drives colour and
    /// crest art — never the position.
    /// </summary>
    public static readonly IReadOnlyList<RankTier> Apex =
        [RankTier.Master, RankTier.Grandmaster, RankTier.Challenger];

    /// <summary>Lowest to highest.</summary>
    public static readonly IReadOnlyList<RankTier> All = [.. Enum.GetValues<RankTier>()];

    /// <summary>Riot's own name for a tier, which is what the database stores.</summary>
    public static string RiotName(this RankTier tier) => tier switch
    {
        RankTier.Iron => "IRON",
        RankTier.Bronze => "BRONZE",
        RankTier.Silver => "SILVER",
        RankTier.Gold => "GOLD",
        RankTier.Platinum => "PLATINUM",
        RankTier.Emerald => "EMERALD",
        RankTier.Diamond => "DIAMOND",
        RankTier.Master => "MASTER",
        RankTier.Grandmaster => "GRANDMASTER",
        RankTier.Challenger => "CHALLENGER",
        _ => throw new ArgumentOutOfRangeException(nameof(tier))
    };

    /// <summary>
    /// The tier a string names, or null if it names none.
    ///
    /// Null rather than an exception, and that is the whole point of this
    /// method. Three sources hand this server tier strings it did not author —
    /// Riot's league-v4, an imported stats.db, and whatever somebody typed —
    /// and Riot has added a tier before. Null is a state the rest of the system
    /// already understands: it is what an unranked account reads as, it makes
    /// <see cref="Ladder.LadderPosition"/> return null, and attribution already
    /// skips a reading it cannot place. So a tier nobody has heard of costs a
    /// blank chip, not a stack trace.
    /// </summary>
    public static RankTier? FromRiotName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;

        // The stored spelling first, and without allocating: every row this
        // server wrote holds Riot's capitals.
        return Exact(name) ?? Exact(name.Trim().ToUpperInvariant());
    }

    /// <summary>
    /// Whether a tier is ranked by ladder cutoffs rather than by LP thresholds.
    ///
    /// A comparison rather than a lookup, which is what the declaration order
    /// of <see cref="RankTier"/> is for.
    /// </summary>
    public static bool IsApex(this RankTier tier) => tier >= RankTier.Master;

    private static RankTier? Exact(string name) => name switch
    {
        "IRON" => RankTier.Iron,
        "BRONZE" => RankTier.Bronze,
        "SILVER" => RankTier.Silver,
        "GOLD" => RankTier.Gold,
        "PLATINUM" => RankTier.Platinum,
        "EMERALD" => RankTier.Emerald,
        "DIAMOND" => RankTier.Diamond,
        "MASTER" => RankTier.Master,
        "GRANDMASTER" => RankTier.Grandmaster,
        "CHALLENGER" => RankTier.Challenger,
        _ => null
    };
}

/// <summary>Divisions, and the Roman numerals Riot spells them with.</summary>
public static class RankDivisions
{
    /// <summary>Lowest to highest, so IV first.</summary>
    public static readonly IReadOnlyList<RankDivision> All = [.. Enum.GetValues<RankDivision>()];

    public static string RiotName(this RankDivision division) => division switch
    {
        RankDivision.IV => "IV",
        RankDivision.III => "III",
        RankDivision.II => "II",
        RankDivision.I => "I",
        _ => throw new ArgumentOutOfRangeException(nameof(division))
    };

    /// <summary>The division a string names, or null. Total, for the same reasons as tiers.</summary>
    public static RankDivision? FromRiotName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        return Exact(name) ?? Exact(name.Trim().ToUpperInvariant());
    }

    private static RankDivision? Exact(string name) => name switch
    {
        "IV" => RankDivision.IV,
        "III" => RankDivision.III,
        "II" => RankDivision.II,
        "I" => RankDivision.I,
        _ => null
    };
}
