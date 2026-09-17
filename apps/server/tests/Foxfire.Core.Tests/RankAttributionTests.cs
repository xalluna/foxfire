using Foxfire.Core;

namespace Foxfire.Core.Tests;

/// <summary>
/// LP attribution, case for case against the desktop's rankAttribution.test.ts.
///
/// A golden corpus rather than a fresh suite. Both implementations compute the
/// LP figure on a match row, both are shown to the same person, and a
/// disagreement would read as lost history rather than as a bug — so the cases
/// are the ones that already passed, with the same fixtures and the same
/// numbers, including the two that record a real incident.
///
/// The desktop's version drives an in-memory SQLite; this one is pure, so where
/// those tests insert a match and assert on a stored row, these pass the match
/// in and assert on the returned attribution. The inputs and the expected
/// numbers are unchanged.
/// </summary>
public class RankAttributionTests
{
    private const long T0 = 1_700_000_000_000;
    private const int SoloQueueId = 420;

    /// <summary>
    /// Season 2026 as the desktop's migration seeds it, then a preseason that
    /// carries rank forward and a 2027 season that resets. The middle row is the
    /// one that proves the guard keys on the reset and not on the boundary.
    /// </summary>
    private static readonly IReadOnlyList<Season> Seasons =
    [
        new(1, "Season 2026", Local(2026, 1, 8), IsPreseason: false, ResetsRank: true),
        new(2, "Preseason 2027", Local(2026, 12, 22), IsPreseason: true, ResetsRank: false),
        new(3, "Season 2027", Local(2027, 1, 8), IsPreseason: false, ResetsRank: true)
    ];

    /// <summary>
    /// Local time, matching how a hand-entered boundary is stored — the desktop's
    /// fixtures use `new Date(2026, 0, 8)`, which is local midnight.
    /// </summary>
    private static long Local(int year, int month, int day, int hour = 0) =>
        new DateTimeOffset(new DateTime(year, month, day, hour, 0, 0, DateTimeKind.Local))
            .ToUnixTimeMilliseconds();

    private static RankReading Snapshot(
        string tier,
        string division,
        int lp,
        long capturedAt,
        int? ladderPosition) =>
        new(RankedQueue.SoloDuo, tier, division, lp, Wins: 10, Losses: 8, ladderPosition, "lcu", capturedAt);

    private static RankedMatch Match(string matchId, long gameCreation, int queueId = SoloQueueId) =>
        new(matchId, gameCreation, queueId, EndedInEarlySurrender: false);

    /* ---------------------------------------------------------------- */
    /* attributeInterval                                                */
    /* ---------------------------------------------------------------- */

    public class Attribute
    {
        [Fact]
        public void Attributes_the_full_delta_when_exactly_one_game_sits_in_the_interval()
        {
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 41, T0 + 1000, 1441),
                [Match("NA1_1", T0 + 500)],
                []);

            Assert.NotNull(result);
            Assert.Equal("NA1_1", result.MatchId);
            Assert.Equal(21, result.LpDelta);
            Assert.False(result.IsPromotion);
            Assert.False(result.IsDemotion);
        }

        [Fact]
        public void Writes_nothing_when_several_games_share_the_interval()
        {
            // The 41 LP could have split any number of ways between the two
            // games, so it is left unattributed rather than guessed at.
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 61, T0 + 1000, 1461),
                [Match("NA1_1", T0 + 200), Match("NA1_2", T0 + 400)],
                []);

            Assert.Null(result);
        }

        [Fact]
        public void Writes_nothing_when_no_game_explains_the_movement()
        {
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 41, T0 + 1000, 1441),
                [],
                []);

            Assert.Null(result);
        }

        [Fact]
        public void Ignores_games_from_another_queue()
        {
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 41, T0 + 1000, 1441),
                [Match("NA1_aram", T0 + 500, queueId: 450)],
                []);

            Assert.Null(result);
        }

        [Fact]
        public void Ignores_remakes()
        {
            // Not in the desktop's suite — its SQL filters these out, so nothing
            // exercised it directly. A remake costs no LP, and counting one would
            // make an unambiguous interval look like it held two games.
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 41, T0 + 1000, 1441),
                [
                    Match("NA1_1", T0 + 500),
                    new RankedMatch("NA1_remake", T0 + 600, SoloQueueId, EndedInEarlySurrender: true)
                ],
                []);

            Assert.NotNull(result);
            Assert.Equal("NA1_1", result.MatchId);
        }

        [Fact]
        public void Computes_the_delta_across_a_division_boundary()
        {
            // Raw LP would read as 12 − 95 = −83 for what was actually a 17 point win.
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "III", 95, T0, 1395),
                Snapshot("GOLD", "II", 12, T0 + 1000, 1412),
                [Match("NA1_1", T0 + 500)],
                []);

            Assert.NotNull(result);
            Assert.Equal(17, result.LpDelta);
            Assert.True(result.IsPromotion);
            Assert.False(result.IsDemotion);
        }

        [Fact]
        public void Flags_a_demotion_across_a_division_boundary()
        {
            var result = RankAttribution.Attribute(
                Snapshot("GOLD", "II", 3, T0, 1403),
                Snapshot("GOLD", "III", 75, T0 + 1000, 1375),
                [Match("NA1_1", T0 + 500)],
                []);

            Assert.NotNull(result);
            Assert.Equal(-28, result.LpDelta);
            Assert.False(result.IsPromotion);
            Assert.True(result.IsDemotion);
        }

        [Fact]
        public void Skips_an_interval_where_either_side_was_unranked()
        {
            Assert.Null(RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, null),
                Snapshot("GOLD", "II", 41, T0 + 1000, 1441),
                [Match("NA1_1", T0 + 500)],
                []));

            Assert.Null(RankAttribution.Attribute(
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 41, T0 + 1000, null),
                [Match("NA1_1", T0 + 500)],
                []));
        }
    }

    /* ---------------------------------------------------------------- */
    /* the interval boundaries                                          */
    /* ---------------------------------------------------------------- */

    public class TheInterval
    {
        [Fact]
        public void Is_exclusive_below_and_inclusive_above()
        {
            // The asymmetry the SQL encodes, asserted directly. A game landing
            // exactly on a reading belongs to the interval ending there, not the
            // one starting there — the other way round it would be counted twice
            // across adjacent pairs and make both ambiguous.
            Assert.False(RankAttribution.InInterval(T0, T0, T0 + 1000));
            Assert.True(RankAttribution.InInterval(T0 + 1, T0, T0 + 1000));
            Assert.True(RankAttribution.InInterval(T0 + 1000, T0, T0 + 1000));
            Assert.False(RankAttribution.InInterval(T0 + 1001, T0, T0 + 1000));
        }

        [Fact]
        public void A_game_on_a_boundary_belongs_to_exactly_one_of_two_adjacent_intervals()
        {
            var first = Snapshot("GOLD", "II", 20, T0, 1420);
            var second = Snapshot("GOLD", "II", 41, T0 + 1000, 1441);
            var third = Snapshot("GOLD", "II", 62, T0 + 2000, 1462);
            RankedMatch[] onTheBoundary = [Match("NA1_edge", T0 + 1000)];

            var earlier = RankAttribution.Attribute(first, second, onTheBoundary, []);
            var later = RankAttribution.Attribute(second, third, onTheBoundary, []);

            Assert.NotNull(earlier);
            Assert.Null(later);
        }
    }

    /* ---------------------------------------------------------------- */
    /* replayAttribution                                                */
    /* ---------------------------------------------------------------- */

    public class Replay
    {
        [Fact]
        public void Attributes_a_game_that_only_arrived_after_both_readings_were_taken()
        {
            // The real ordering: the client reports the new LP within a minute of
            // the game ending, and Riot publishes the match minutes later. Inline
            // attribution at snapshot time therefore always found nothing.
            var results = RankAttribution.Replay(
                [Snapshot("GOLD", "II", 20, T0, 1420), Snapshot("GOLD", "II", 41, T0 + 1000, 1441)],
                [Match("NA1_1", T0 + 500)],
                []);

            Assert.Single(results);
            Assert.Equal(21, results[0].LpDelta);
        }

        [Fact]
        public void Walks_every_interval_not_just_the_most_recent()
        {
            var results = RankAttribution.Replay(
                [
                    Snapshot("GOLD", "II", 20, T0, 1420),
                    Snapshot("GOLD", "II", 41, T0 + 1000, 1441),
                    Snapshot("GOLD", "II", 23, T0 + 2000, 1423)
                ],
                [Match("NA1_1", T0 + 500), Match("NA1_2", T0 + 1500)],
                []);

            Assert.Equal(2, results.Count);
            Assert.Equal(21, results.Single(r => r.MatchId == "NA1_1").LpDelta);
            Assert.Equal(-18, results.Single(r => r.MatchId == "NA1_2").LpDelta);
        }

        [Fact]
        public void Is_idempotent_a_second_pass_decides_the_same_thing()
        {
            RankReading[] snapshots =
            [
                Snapshot("GOLD", "II", 20, T0, 1420),
                Snapshot("GOLD", "II", 41, T0 + 1000, 1441)
            ];
            RankedMatch[] matches = [Match("NA1_1", T0 + 500)];

            var first = RankAttribution.Replay(snapshots, matches, []);
            var second = RankAttribution.Replay(snapshots, matches, []);

            Assert.Equal(first, second);
        }

        [Fact]
        public void Leaves_an_ambiguous_interval_alone_however_often_it_runs()
        {
            var results = RankAttribution.Replay(
                [Snapshot("GOLD", "II", 20, T0, 1420), Snapshot("GOLD", "II", 61, T0 + 1000, 1461)],
                [Match("NA1_1", T0 + 200), Match("NA1_2", T0 + 400)],
                []);

            Assert.Empty(results);
        }

        [Fact]
        public void Has_no_interval_to_attribute_with_fewer_than_two_readings()
        {
            // The desktop expresses this as a time window that leaves one reading
            // behind; the shape it produces is a single snapshot and no pair.
            Assert.Empty(RankAttribution.Replay(
                [Snapshot("GOLD", "II", 41, T0 + 1000, 1441)],
                [Match("NA1_1", T0 + 500)],
                []));

            Assert.Empty(RankAttribution.Replay([], [Match("NA1_1", T0 + 500)], []));
        }

        /// <summary>
        /// The shape of a real incident: two ranked games in a row, each recorded
        /// as worth 0 LP when they were in fact worth −7 and +21.
        ///
        /// The cause was upstream of attribution — the watcher forced a reading
        /// the moment the game ended, and the client was still serving the
        /// pre-game rank — but this is where the cost was visible, and it is why
        /// the settling rules exist. Positions are Platinum IV at 7, 0 and 21 LP.
        /// </summary>
        public class AReadingTakenBeforeTheClientCaughtUp
        {
            private const long Loss = T0 + 1000;
            private const long Win = T0 + 4000;

            private static readonly RankedMatch[] Games = [Match("NA1_LOSS", Loss), Match("NA1_WIN", Win)];

            private static RankReading Plat(int lp, long capturedAt) =>
                new(RankedQueue.SoloDuo, "PLATINUM", "IV", lp, 10, 8, 1600 + lp, "lcu", capturedAt);

            [Fact]
            public void Costs_both_games_their_lp_when_the_stale_reading_is_stored()
            {
                var results = RankAttribution.Replay(
                    [
                        Plat(7, T0),
                        // Forced as the loss ended, still reporting the rank it started with.
                        Plat(7, T0 + 2000),
                        Plat(0, T0 + 3000),
                        // And again as the win ended.
                        Plat(0, T0 + 5000),
                        Plat(21, T0 + 6000)
                    ],
                    Games,
                    []);

                // Each game is bracketed by two identical readings, so it measures
                // as 0. The real movement lands in the interval that follows,
                // which holds no game at all and is therefore thrown away — and
                // because attribution is replayed on every pass, the 0 comes back
                // however often it is cleared.
                Assert.Equal(2, results.Count);
                Assert.Equal(0, results.Single(r => r.MatchId == "NA1_LOSS").LpDelta);
                Assert.Equal(0, results.Single(r => r.MatchId == "NA1_WIN").LpDelta);
            }

            [Fact]
            public void Attributes_both_games_once_the_reading_is_left_to_settle()
            {
                // The same polls, minus the two the watcher no longer forces early.
                var results = RankAttribution.Replay(
                    [Plat(7, T0), Plat(0, T0 + 3000), Plat(21, T0 + 6000)],
                    Games,
                    []);

                Assert.Equal(2, results.Count);
                Assert.Equal(-7, results.Single(r => r.MatchId == "NA1_LOSS").LpDelta);
                Assert.Equal(21, results.Single(r => r.MatchId == "NA1_WIN").LpDelta);
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /* the ladder reset                                                 */
    /* ---------------------------------------------------------------- */

    public class TheLadderReset
    {
        private static readonly long Dec = Local(2026, 12, 28, 20);
        private static readonly long Jan = Local(2027, 1, 8, 14);

        // Real ladder positions: Emerald II 20 LP against Bronze IV 0 LP is a
        // 1,820 point fall, which is the number that would land on the game
        // beside it.
        private const int EmeraldII = 2220;
        private const int BronzeIV = 400;

        [Fact]
        public void Refuses_to_attribute_the_annual_reset_to_the_one_game_beside_it()
        {
            // The exact shape that would otherwise poison a match forever: a
            // December reading, a January one after the reset, and a single
            // ranked game between them for the delta to land on.
            var result = RankAttribution.Attribute(
                Snapshot("EMERALD", "II", 20, Dec, EmeraldII),
                Snapshot("BRONZE", "IV", 0, Jan, BronzeIV),
                [Match("NA1_1", Jan - 3_600_000)],
                Seasons);

            Assert.Null(result);
        }

        [Fact]
        public void Still_attributes_normally_on_either_side_of_the_boundary()
        {
            // The guard must be narrow: two readings inside the same year
            // attribute as they always did, even in the days right before a reset.
            var result = RankAttribution.Attribute(
                Snapshot("EMERALD", "II", 20, Dec, EmeraldII),
                Snapshot("EMERALD", "II", 41, Dec + 1000, EmeraldII + 21),
                [Match("NA1_1", Dec + 500)],
                Seasons);

            Assert.NotNull(result);
            Assert.Equal(21, result.LpDelta);
        }

        [Fact]
        public void Still_attributes_across_a_boundary_that_carried_rank_forward()
        {
            // Into the preseason: a real period boundary, but the ladder was not
            // emptied, so the game between these readings earned its LP and must
            // keep it. Suppressing here would be a silent false negative.
            var before = Local(2026, 12, 20, 20);
            var after = Local(2026, 12, 24, 20);

            var result = RankAttribution.Attribute(
                Snapshot("EMERALD", "II", 20, before, EmeraldII),
                Snapshot("EMERALD", "II", 41, after, EmeraldII + 21),
                [Match("NA1_1", before + 1000)],
                Seasons);

            Assert.NotNull(result);
            Assert.Equal(21, result.LpDelta);
        }

        [Fact]
        public void Survives_repeated_replays_which_is_how_the_figure_used_to_return()
        {
            // Attribution is replayed unbounded on every pass, so a guard that
            // only held the first time would be no guard at all.
            RankReading[] snapshots =
            [
                Snapshot("EMERALD", "II", 20, Dec, EmeraldII),
                Snapshot("BRONZE", "IV", 0, Jan, BronzeIV)
            ];
            RankedMatch[] matches = [Match("NA1_1", Jan - 3_600_000)];

            Assert.Empty(RankAttribution.Replay(snapshots, matches, Seasons));
            Assert.Empty(RankAttribution.Replay(snapshots, matches, Seasons));
        }

        [Fact]
        public void Cannot_fire_with_no_seasons_recorded()
        {
            // The cost of the boundaries being hand-entered, and stated so that
            // it is a decision rather than a surprise.
            var result = RankAttribution.Attribute(
                Snapshot("EMERALD", "II", 20, Dec, EmeraldII),
                Snapshot("BRONZE", "IV", 0, Jan, BronzeIV),
                [Match("NA1_1", Jan - 3_600_000)],
                []);

            Assert.NotNull(result);
            Assert.Equal(BronzeIV - EmeraldII, result.LpDelta);
        }
    }
}
