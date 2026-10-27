using Foxfire.Core;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Foxfire.Data;

/// <summary>
/// How a tier and a division cross into SQL Server and back.
///
/// Riot's own spelling in both directions, which is what every row already
/// holds — so putting these on the four entities that name a rank changed the
/// C# and left the database exactly where it was.
///
/// The read direction is total on purpose. <see cref="RankTiers.FromRiotName"/>
/// answers null for a string it does not recognise rather than throwing, and a
/// converter is the worst possible place to throw: it runs during
/// materialization, so one odd row does not produce one odd value, it fails the
/// whole query with a stack trace that names nothing to do with ranks. Riot
/// added a tier in 2023 and can do it again.
///
/// Null is the right answer because the system already knows what to do with
/// it — an unranked reading is null, <see cref="Ladder.LadderPosition"/> gives
/// null for anything it cannot place, and attribution skips it. A tier nobody
/// has heard of costs a blank chip on one row.
///
/// The one seam it leaves: a row holding an unrecognised tier still satisfies a
/// SQL `Tier IS NOT NULL` and then materializes as null. That is the price of
/// not throwing, and it is worth paying.
/// </summary>
internal static class RankConverters
{
    public static readonly ValueConverter<RankTier?, string?> Tier = new(
        tier => tier == null ? null : tier.Value.RiotName(),
        stored => RankTiers.FromRiotName(stored));

    public static readonly ValueConverter<RankDivision?, string?> Division = new(
        division => division == null ? null : division.Value.RiotName(),
        stored => RankDivisions.FromRiotName(stored));

    /// <summary>Hyper Roll's colour, total in the same way as a tier.</summary>
    public static readonly ValueConverter<RatedTier?, string?> RatedTier = new(
        tier => tier == null ? null : tier.Value.RiotName(),
        stored => RatedTiers.FromRiotName(stored));
}

/// <summary>
/// How a game and a key scope cross into SQL Server and back: as their slugs,
/// `lol` and `tft`, `main` and `tft`, which is also how the wire spells them.
///
/// Total on read for the reasons above. A slug this build has never heard of —
/// a row written by a newer server, then rolled back — reads as League's and
/// main, which is what every row was before the column existed.
/// </summary>
internal static class GameConverters
{
    public static readonly ValueConverter<Game, string> Game = new(
        game => game.Slug(),
        stored => Games.FromSlug(stored) ?? Core.Game.Lol);

    public static readonly ValueConverter<RiotKeyScope, string> Scope = new(
        scope => scope.Slug(),
        stored => stored == "tft" ? RiotKeyScope.Tft : RiotKeyScope.Main);
}
