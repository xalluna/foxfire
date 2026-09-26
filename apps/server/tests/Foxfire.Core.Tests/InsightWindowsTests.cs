namespace Foxfire.Core.Tests;

public sealed class InsightWindowsTests
{
    [Fact]
    public void No_window_draws_more_than_360_points() =>
        Assert.All(InsightWindows.All, w => Assert.InRange(w.Points, 1, 360));

    [Fact]
    public void Every_step_is_made_of_whole_buckets_of_its_source()
    {
        foreach (var window in InsightWindows.All)
        {
            var bucket = window.Source switch
            {
                InsightSource.Live => InsightWindows.LiveStep,
                InsightSource.Minutes => TimeSpan.FromMinutes(1),
                _ => TimeSpan.FromHours(1)
            };

            Assert.Equal(0, window.Step.Ticks % bucket.Ticks);
        }
    }

    [Fact]
    public void Windows_read_from_memory_and_minutes_fit_in_what_is_kept()
    {
        foreach (var window in InsightWindows.All)
        {
            if (window.Source == InsightSource.Live) Assert.True(window.Span <= InsightWindows.LiveSpan);
            if (window.Source == InsightSource.Minutes) Assert.True(window.Span <= InsightWindows.MinuteSpan);
        }
    }

    [Fact]
    public void The_last_point_is_the_step_now_falls_in()
    {
        var now = new DateTimeOffset(2026, 9, 26, 14, 37, 42, TimeSpan.Zero);
        var window = InsightWindows.OneHour;

        var from = window.From(now);

        Assert.Equal(new DateTimeOffset(2026, 9, 26, 13, 38, 0, TimeSpan.Zero), from);
        Assert.Equal(new DateTimeOffset(2026, 9, 26, 14, 37, 0, TimeSpan.Zero), from + (window.Step * (window.Points - 1)));
    }

    [Fact]
    public void Steps_are_aligned_in_utc_whatever_the_offset()
    {
        var local = new DateTimeOffset(2026, 9, 26, 9, 15, 0, TimeSpan.FromHours(-5));

        Assert.Equal(
            new DateTimeOffset(2026, 9, 26, 14, 0, 0, TimeSpan.Zero),
            InsightWindow.Floor(local, TimeSpan.FromHours(2)));
    }

    [Theory]
    [InlineData(null, "1h")]
    [InlineData("", "1h")]
    [InlineData("15m", "15m")]
    [InlineData("30D", "30d")]
    public void A_window_is_found_by_its_key(string? key, string expected) =>
        Assert.Equal(expected, InsightWindows.Parse(key)!.Key);

    [Fact]
    public void Something_that_is_not_a_window_is_not_one() =>
        Assert.Null(InsightWindows.Parse("3y"));
}
