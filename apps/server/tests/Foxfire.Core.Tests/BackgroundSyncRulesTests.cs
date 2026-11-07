using Foxfire.Core;

namespace Foxfire.Core.Tests;

/// <summary>
/// When the timed sweep runs, whom it leaves alone, and in what order it goes.
/// </summary>
public class BackgroundSyncRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 29, 20, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_process_that_has_not_swept_yet_is_due()
    {
        Assert.True(BackgroundSyncRules.IsSweepDue(null, Now, TimeSpan.FromMinutes(30)));
    }

    [Theory]
    [InlineData(29, false)]
    [InlineData(30, true)]
    [InlineData(45, true)]
    public void A_sweep_is_due_once_the_interval_has_passed_since_the_last_one_started(int minutesAgo, bool due)
    {
        Assert.Equal(
            due,
            BackgroundSyncRules.IsSweepDue(Now.AddMinutes(-minutesAgo), Now, TimeSpan.FromMinutes(30)));
    }

    [Fact]
    public void A_history_that_has_never_been_synced_is_never_fresh()
    {
        Assert.False(BackgroundSyncRules.IsFresh(null, Now, TimeSpan.FromMinutes(15)));
    }

    [Theory]
    [InlineData(5, true)]
    [InlineData(14, true)]
    [InlineData(15, false)]
    [InlineData(40, false)]
    public void A_history_synced_inside_the_window_is_left_alone(int minutesAgo, bool fresh)
    {
        Assert.Equal(
            fresh,
            BackgroundSyncRules.IsFresh(Now.AddMinutes(-minutesAgo), Now, TimeSpan.FromMinutes(15)));
    }

    [Theory]
    [InlineData(30, 15, true)]
    [InlineData(30, 29, true)]
    [InlineData(30, 30, false)]
    [InlineData(30, 45, false)]
    [InlineData(30, 0, false)]
    public void The_window_has_to_be_shorter_than_the_interval(int interval, int skip, bool fits)
    {
        // As long as the interval, it would skip everybody the previous sweep
        // reached — and "every fifteen minutes" would mean every thirty.
        Assert.Equal(fits, BackgroundSyncRules.Fits(interval, skip));
    }

    [Fact]
    public void The_stalest_go_first_and_the_never_synced_last()
    {
        var a = Guid.Parse("00000000-0000-0000-0000-00000000000a");
        var b = Guid.Parse("00000000-0000-0000-0000-00000000000b");
        var c = Guid.Parse("00000000-0000-0000-0000-00000000000c");

        var ordered = BackgroundSyncRules.Order(
        [
            new BackgroundSyncCandidate(c, Game.Lol, null),
            new BackgroundSyncCandidate(b, Game.Lol, Now.AddMinutes(-20)),
            new BackgroundSyncCandidate(a, Game.Tft, null),
            new BackgroundSyncCandidate(a, Game.Lol, Now.AddMinutes(-90)),
            new BackgroundSyncCandidate(c, Game.Tft, Now.AddMinutes(-40))
        ]);

        Assert.Equal(
            [(a, Game.Lol), (c, Game.Tft), (b, Game.Lol), (a, Game.Tft), (c, Game.Lol)],
            ordered.Select(o => (o.RiotAccountId, o.Game)));
    }

    [Fact]
    public void Ties_go_by_account_then_game_so_the_order_is_the_same_every_time()
    {
        var a = Guid.Parse("00000000-0000-0000-0000-00000000000a");
        var b = Guid.Parse("00000000-0000-0000-0000-00000000000b");
        var at = Now.AddMinutes(-30);

        var ordered = BackgroundSyncRules.Order(
        [
            new BackgroundSyncCandidate(b, Game.Lol, at),
            new BackgroundSyncCandidate(a, Game.Tft, at),
            new BackgroundSyncCandidate(a, Game.Lol, at)
        ]);

        Assert.Equal(
            [(a, Game.Lol), (a, Game.Tft), (b, Game.Lol)],
            ordered.Select(o => (o.RiotAccountId, o.Game)));
    }
}
