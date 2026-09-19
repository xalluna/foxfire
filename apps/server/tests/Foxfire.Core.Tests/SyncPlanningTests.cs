using Foxfire.Core;

namespace Foxfire.Core.Tests;

/// <summary>
/// What a sync decides to fetch, tested without fetching anything.
///
/// These are small enough to look obviously right and were worth extracting
/// anyway, because each has a case that is not obvious at all: a marker that is
/// not in the page, a target that is not a multiple of the page size, and the
/// three identity outcomes that must not be retried.
/// </summary>
public class SyncPlanningTests
{
    [Fact]
    public void Everything_is_new_when_nothing_has_been_stored()
    {
        string[] ids = ["NA1_3", "NA1_2", "NA1_1"];

        Assert.Equal(ids, SyncPlanning.SelectNewMatchIds(ids, null));
    }

    [Fact]
    public void Only_matches_newer_than_the_marker_are_selected()
    {
        // Riot's list is newest first, so everything before the marker is new
        // and the marker itself is already stored.
        string[] ids = ["NA1_5", "NA1_4", "NA1_3", "NA1_2"];

        Assert.Equal(["NA1_5", "NA1_4"], SyncPlanning.SelectNewMatchIds(ids, "NA1_3"));
    }

    [Fact]
    public void A_marker_that_is_not_in_the_page_means_the_whole_page_is_new()
    {
        // The stored history is older than this entire page — which is what a
        // long absence looks like. Taking nothing would be the dangerous reading
        // of the same evidence.
        string[] ids = ["NA1_9", "NA1_8"];

        Assert.Equal(ids, SyncPlanning.SelectNewMatchIds(ids, "NA1_1"));
    }

    [Fact]
    public void The_marker_at_the_top_means_there_is_nothing_new()
    {
        string[] ids = ["NA1_5", "NA1_4"];

        Assert.Empty(SyncPlanning.SelectNewMatchIds(ids, "NA1_5"));
    }

    [Theory]
    [InlineData(200, 100, new[] { 100, 100 })]
    [InlineData(250, 100, new[] { 100, 100, 50 })]
    [InlineData(40, 100, new[] { 40 })]
    [InlineData(0, 100, new int[0])]
    public void Pages_never_exceed_Riots_maximum_and_never_overshoot_the_target(
        int target,
        int pageSize,
        int[] expected)
    {
        Assert.Equal(expected, SyncPlanning.PlanMatchIdPages(target, pageSize));
    }

    [Fact]
    public void Only_a_moved_puuid_earns_a_retry()
    {
        var plan = SyncPlanning.AfterIdentityRepair(IdentityOutcome.Repaired, "Faker#KR");

        Assert.True(plan.Retry);
        Assert.Null(plan.Message);
    }

    [Theory]
    [InlineData(IdentityOutcome.Unresolved)]
    [InlineData(IdentityOutcome.Failed)]
    [InlineData(IdentityOutcome.Unchanged)]
    public void Every_other_outcome_stops_with_something_to_act_on(IdentityOutcome outcome)
    {
        // The same request would fail the same way a second time, so a retry
        // would only spend another of the community's Riot calls to learn
        // nothing. Each of these has its own thing to tell somebody.
        var plan = SyncPlanning.AfterIdentityRepair(outcome, "Faker#KR");

        Assert.False(plan.Retry);
        Assert.NotNull(plan.Message);
        Assert.Contains("Faker#KR", plan.Message, StringComparison.Ordinal);
    }
}
