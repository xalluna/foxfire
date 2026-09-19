namespace Foxfire.Core.Tests;

/// <summary>
/// Riot's spelling, for tests that would rather read as the ladder than as C#.
///
/// Strict, unlike the thing it wraps. <see cref="RankTiers.FromRiotName"/> is
/// deliberately total — it answers null for anything it does not know, because
/// that is the right way to treat a row out of a database or a payload out of
/// Riot. Here it would be the wrong way: a tier that is not one is a typo in a
/// test, and a typo that quietly became "unranked" would make an assertion pass
/// for a reason nobody intended.
///
/// The one case that genuinely wants the total behaviour is the corpus, which
/// carries a NOT_A_TIER and asserts both implementations answer null for it.
/// That one calls FromRiotName directly.
/// </summary>
internal static class RankSpelling
{
    public static RankTier? Tier(string? name) =>
        name is null
            ? null
            : RankTiers.FromRiotName(name) ?? throw new ArgumentException($"{name} is not a tier", nameof(name));

    public static RankDivision? Division(string? name) =>
        name is null
            ? null
            : RankDivisions.FromRiotName(name)
              ?? throw new ArgumentException($"{name} is not a division", nameof(name));
}
