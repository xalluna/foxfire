using Foxfire.Core;

namespace Foxfire.Core.Tests;

/// <summary>
/// Hyper Roll's rated ladder through the same attribution rule League's LP
/// goes through: the rating is the position, so the delta is the change in
/// rating, and a promotion is a change of colour.
/// </summary>
public class RatedLadderTests
{
    private const long T0 = 1_790_000_000_000;

    private static RankReading Rated(string tier, int rating, long capturedAt) =>
        new(RankedQueue.TftHyperRoll, Tier: null, Division: null, LeaguePoints: null, Wins: null, Losses: null,
            LadderPosition: Ladders.PositionOf(RankedQueue.TftHyperRoll, new Rank(null, null, null), rating),
            "lcu", capturedAt, RatedTiers.FromRiotName(tier));

    private static RankedMatch HyperRoll(string matchId, long endedAt) =>
        new(matchId, endedAt - 900_000, 900, RankedQueue.TftHyperRoll.QueueId(), EndedInEarlySurrender: false);

    [Fact]
    public void A_rated_position_is_the_rating()
    {
        Assert.Equal(3612, Ladders.PositionOf(RankedQueue.TftHyperRoll, new Rank(null, null, null), 3612));
        Assert.Null(Ladders.PositionOf(RankedQueue.TftHyperRoll, new Rank(null, null, null), null));
        Assert.Equal(50, Ladders.PositionOf(RankedQueue.Tft, new Rank(RankTier.Iron, RankDivision.IV, 50), null));
    }

    [Fact]
    public void Attributes_the_change_in_rating_to_the_one_game_between_two_readings()
    {
        var result = RankAttribution.Attribute(
            Rated("BLUE", 3360, T0),
            Rated("PURPLE", 3412, T0 + 2_000_000),
            [HyperRoll("NA1_1", T0 + 1_000_000)],
            []);

        Assert.NotNull(result);
        Assert.Equal(52, result.LpDelta);
        Assert.True(result.IsPromotion);
        Assert.Equal(RatedTier.Blue, result.RatedTierBefore);
        Assert.Equal(RatedTier.Purple, result.RatedTierAfter);
    }

    [Fact]
    public void Inside_one_colour_is_no_movement()
    {
        Assert.Equal(RankMovement.None, Ladders.Movement(Rated("BLUE", 2700, T0), Rated("BLUE", 2900, T0 + 1)));
        Assert.Equal(RankMovement.Demotion, Ladders.Movement(Rated("BLUE", 2610, T0), Rated("GREEN", 2580, T0 + 1)));
    }

    [Fact]
    public void Spells_its_colours_as_riot_does_and_reads_anything_else_as_none()
    {
        Assert.Equal(RatedTier.Orange, RatedTiers.FromRiotName(" orange "));
        Assert.Null(RatedTiers.FromRiotName("TEAL"));
        Assert.Equal("GRAY", RatedTier.Gray.RiotName());
    }
}
