namespace Foxfire.Email.Tests;

public sealed class EmailWindowsTests
{
    private static DateTimeOffset Utc(int year, int month, int day, int hour = 0, int minute = 0) =>
        new(year, month, day, hour, minute, 0, TimeSpan.Zero);

    [Fact]
    public void The_day_is_the_utc_calendar_day()
    {
        var window = EmailWindows.Day(Utc(2026, 9, 26, 23, 59));

        Assert.Equal(Utc(2026, 9, 26), window.Start);
        Assert.Equal(Utc(2026, 9, 27), window.End);
    }

    [Fact]
    public void Midnight_starts_the_next_day() =>
        Assert.Equal(Utc(2026, 9, 27), EmailWindows.Day(Utc(2026, 9, 27)).Start);

    [Fact]
    public void An_offset_clock_is_read_in_utc()
    {
        // 01:00 on the 27th in UTC+2 is still the 26th in UTC.
        var window = EmailWindows.Day(new DateTimeOffset(2026, 9, 27, 1, 0, 0, TimeSpan.FromHours(2)));

        Assert.Equal(Utc(2026, 9, 26), window.Start);
    }

    [Fact]
    public void Reset_day_one_is_the_calendar_month()
    {
        var window = EmailWindows.Month(Utc(2026, 9, 15), 1);

        Assert.Equal(Utc(2026, 9, 1), window.Start);
        Assert.Equal(Utc(2026, 10, 1), window.End);
    }

    [Fact]
    public void Before_the_reset_day_the_window_began_last_month()
    {
        var window = EmailWindows.Month(Utc(2026, 9, 10), 15);

        Assert.Equal(Utc(2026, 8, 15), window.Start);
        Assert.Equal(Utc(2026, 9, 15), window.End);
    }

    [Fact]
    public void On_the_reset_day_a_new_window_begins()
    {
        var window = EmailWindows.Month(Utc(2026, 9, 15), 15);

        Assert.Equal(Utc(2026, 9, 15), window.Start);
        Assert.Equal(Utc(2026, 10, 15), window.End);
    }

    [Fact]
    public void A_day_february_does_not_have_is_its_last()
    {
        var window = EmailWindows.Month(Utc(2027, 2, 20), 31);

        Assert.Equal(Utc(2027, 1, 31), window.Start);
        Assert.Equal(Utc(2027, 2, 28), window.End);
    }

    [Fact]
    public void After_a_short_month_the_window_runs_to_the_long_day_again()
    {
        var window = EmailWindows.Month(Utc(2027, 2, 28, 12), 31);

        Assert.Equal(Utc(2027, 2, 28), window.Start);
        Assert.Equal(Utc(2027, 3, 31), window.End);
    }

    [Fact]
    public void April_has_thirty_days()
    {
        var window = EmailWindows.Month(Utc(2027, 4, 30, 8), 31);

        Assert.Equal(Utc(2027, 4, 30), window.Start);
        Assert.Equal(Utc(2027, 5, 31), window.End);
    }

    [Fact]
    public void The_year_turns()
    {
        var window = EmailWindows.Month(Utc(2026, 12, 20), 15);

        Assert.Equal(Utc(2026, 12, 15), window.Start);
        Assert.Equal(Utc(2027, 1, 15), window.End);
    }
}
