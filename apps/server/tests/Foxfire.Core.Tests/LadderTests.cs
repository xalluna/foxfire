using Foxfire.Core;

namespace Foxfire.Core.Tests;

/// <summary>
/// The ladder arithmetic, case for case against the desktop's ladder.test.ts.
///
/// Ported rather than rewritten. These are a golden corpus: the desktop and the
/// server both compute LP, both of them are shown to the same person, and a
/// disagreement between them would look like data loss rather than like a bug.
/// </summary>
public class LadderTests
{
    private static Rank At(string? tier, string? division, int? lp) => new(tier, division, lp);

    public class LadderPosition
    {
        [Fact]
        public void Starts_at_iron_four_zero_lp()
        {
            Assert.Equal(0, Ladder.LadderPosition(At("IRON", "IV", 0)));
        }

        [Theory]
        [InlineData("IV", 0, 1200)]
        [InlineData("III", 0, 1300)]
        [InlineData("II", 50, 1450)]
        [InlineData("I", 99, 1599)]
        public void Orders_divisions_within_a_tier(string division, int lp, int expected)
        {
            Assert.Equal(expected, Ladder.LadderPosition(At("GOLD", division, lp)));
        }

        [Fact]
        public void Meets_the_apex_scale_exactly_at_diamond_one_hundred()
        {
            Assert.Equal(Ladder.ApexBase, Ladder.LadderPosition(At("DIAMOND", "I", 100)));
            Assert.Equal(Ladder.ApexBase, Ladder.LadderPosition(At("MASTER", "I", 0)));
        }

        [Theory]
        [InlineData("MASTER")]
        [InlineData("GRANDMASTER")]
        [InlineData("CHALLENGER")]
        public void Treats_the_apex_tiers_as_one_shared_scale(string tier)
        {
            // Decided by ladder cutoffs rather than LP, so the same LP is the
            // same position whichever name it carries.
            Assert.Equal(3300, Ladder.LadderPosition(At(tier, "I", 500)));
        }

        [Fact]
        public void Is_null_when_unranked_or_unusable()
        {
            Assert.Null(Ladder.LadderPosition(At(null, null, null)));
            Assert.Null(Ladder.LadderPosition(At("GOLD", null, 50)));
            Assert.Null(Ladder.LadderPosition(At("NOT_A_TIER", "I", 50)));
        }

        [Fact]
        public void Treats_missing_lp_as_zero_rather_than_unranked()
        {
            Assert.Equal(1000, Ladder.LadderPosition(At("SILVER", "II", null)));
        }
    }

    public class Movement
    {
        [Theory]
        [InlineData(20, 43)]
        [InlineData(43, 26)]
        public void Ignores_lp_changes_inside_a_division(int before, int after)
        {
            Assert.Equal(
                RankMovement.None,
                Ladder.Movement(At("GOLD", "II", before), At("GOLD", "II", after)));
        }

        [Fact]
        public void Detects_division_promotions_and_demotions()
        {
            Assert.Equal(
                RankMovement.Promotion,
                Ladder.Movement(At("GOLD", "II", 98), At("GOLD", "I", 12)));
            Assert.Equal(
                RankMovement.Demotion,
                Ladder.Movement(At("GOLD", "II", 3), At("GOLD", "III", 75)));
        }

        [Fact]
        public void Detects_tier_promotions_and_demotions()
        {
            Assert.Equal(
                RankMovement.Promotion,
                Ladder.Movement(At("GOLD", "I", 98), At("PLATINUM", "IV", 12)));
            Assert.Equal(
                RankMovement.Demotion,
                Ladder.Movement(At("PLATINUM", "IV", 0), At("GOLD", "I", 75)));
        }

        [Fact]
        public void Treats_master_to_grandmaster_as_a_promotion_despite_the_shared_position()
        {
            Assert.Equal(
                RankMovement.Promotion,
                Ladder.Movement(At("MASTER", "I", 500), At("GRANDMASTER", "I", 500)));
            Assert.Equal(
                RankMovement.Demotion,
                Ladder.Movement(At("CHALLENGER", "I", 900), At("GRANDMASTER", "I", 880)));
        }

        [Fact]
        public void Is_none_when_either_side_is_unranked()
        {
            Assert.Equal(RankMovement.None, Ladder.Movement(At(null, null, null), At("IRON", "IV", 0)));
            Assert.Equal(RankMovement.None, Ladder.Movement(At("IRON", "IV", 0), At(null, null, null)));
        }
    }

    public class RankFromLeaguePoints
    {
        [Fact]
        public void Keeps_a_normal_result_inside_the_division_it_started_in()
        {
            Assert.Equal(new Rank("GOLD", "I", 68), Ladder.RankFromLeaguePoints(At("GOLD", "I", 85), 68));
        }

        [Fact]
        public void Reads_a_small_number_after_a_high_one_as_a_promotion()
        {
            // Gold I 85 to 3 LP is Platinum IV 3 (+18), not Gold I 3 (−82).
            Assert.Equal(
                new Rank("PLATINUM", "IV", 3),
                Ladder.RankFromLeaguePoints(At("GOLD", "I", 85), 3));
        }

        [Fact]
        public void Reads_a_high_number_after_a_low_one_as_a_demotion()
        {
            Assert.Equal(
                new Rank("GOLD", "I", 91),
                Ladder.RankFromLeaguePoints(At("PLATINUM", "IV", 8), 91));
        }

        [Fact]
        public void Crosses_into_the_apex_tiers()
        {
            Assert.Equal(
                new Rank("MASTER", "I", 5),
                Ladder.RankFromLeaguePoints(At("DIAMOND", "I", 88), 5));
        }

        [Fact]
        public void Declines_to_guess_from_an_apex_rank_where_lp_runs_unbounded()
        {
            // 75 LP from Master 12 means Master 75, not a drop to Diamond I.
            Assert.Null(Ladder.RankFromLeaguePoints(At("MASTER", "I", 12), 75));
        }

        [Fact]
        public void Has_nowhere_below_iron_four_to_place_a_large_jump()
        {
            Assert.Equal(
                new Rank("IRON", "IV", 88),
                Ladder.RankFromLeaguePoints(At("IRON", "IV", 5), 88));
        }

        [Fact]
        public void Declines_when_the_starting_rank_cannot_be_placed()
        {
            Assert.Null(Ladder.RankFromLeaguePoints(At(null, null, null), 40));
            Assert.Null(Ladder.RankFromLeaguePoints(At("GOLD", null, 20), 40));
        }

        [Fact]
        public void Breaks_a_tie_upward_the_way_javascript_does()
        {
            // Not in the desktop's suite, and the one place the two languages
            // would otherwise disagree. Gold II 0 LP is 1400; typing 50 LP puts
            // the division arithmetic at exactly 13.5, which JavaScript rounds to
            // 14 and .NET's default rounding would take to 14 as well — but from
            // Gold III 0 (1300) typing 50 gives 12.5, where .NET's round-to-even
            // would say 12 and JavaScript says 13.
            Assert.Equal(
                new Rank("GOLD", "III", 50),
                Ladder.RankFromLeaguePoints(At("GOLD", "III", 0), 50));
            Assert.Equal(
                new Rank("GOLD", "II", 50),
                Ladder.RankFromLeaguePoints(At("GOLD", "II", 0), 50));
        }
    }

    public class TierAtPosition
    {
        [Theory]
        [InlineData(0, "IRON")]
        [InlineData(1250, "GOLD")]
        public void Maps_a_position_back_to_its_tier(int position, string expected)
        {
            Assert.Equal(expected, Ladder.TierAtPosition(position));
        }

        [Fact]
        public void Maps_every_apex_position_to_master()
        {
            Assert.Equal("MASTER", Ladder.TierAtPosition(Ladder.ApexBase));
            Assert.Equal("MASTER", Ladder.TierAtPosition(Ladder.ApexBase + 1200));
        }
    }
}
