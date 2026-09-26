namespace Foxfire.Email.Tests;

public sealed class EmailBudgetTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 26, 12, 0, 0, TimeSpan.Zero);
    private static readonly EmailWindow Day = EmailWindows.Day(Now);
    private static readonly EmailWindow Month = EmailWindows.Month(Now, 1);

    private static EmailWindowState Daily(int used, int limit = 100, DateTimeOffset? latch = null) =>
        new(used, limit, Day, latch);

    private static EmailWindowState Monthly(int used, int limit = 3000, DateTimeOffset? latch = null) =>
        new(used, limit, Month, latch);

    private static EmailBudgetDecision Decide(
        EmailPriority priority,
        EmailWindowState daily,
        EmailWindowState monthly,
        double share = 0.8) =>
        EmailBudget.Decide(priority, share, daily, monthly, Now);

    [Fact]
    public void Room_in_both_windows_admits() =>
        Assert.IsType<EmailBudgetDecision.Admit>(Decide(EmailPriority.Standard, Daily(10), Monthly(10)));

    [Fact]
    public void A_full_day_holds_until_utc_midnight()
    {
        var hold = Assert.IsType<EmailBudgetDecision.Hold>(Decide(EmailPriority.Security, Daily(100), Monthly(500)));

        Assert.Equal(Day.End, hold.Until);
        Assert.Equal(EmailBudget.DailyLimit, hold.Reason);
    }

    [Fact]
    public void A_full_month_holds_until_the_month_turns_even_when_the_day_is_full_too()
    {
        var hold = Assert.IsType<EmailBudgetDecision.Hold>(Decide(EmailPriority.Security, Daily(100), Monthly(3000)));

        Assert.Equal(Month.End, hold.Until);
        Assert.Equal(EmailBudget.MonthlyLimit, hold.Reason);
    }

    [Fact]
    public void Standard_mail_stops_at_its_share_of_the_day()
    {
        var hold = Assert.IsType<EmailBudgetDecision.Hold>(Decide(EmailPriority.Standard, Daily(80), Monthly(80)));

        Assert.Equal(EmailBudget.StandardShare, hold.Reason);
        Assert.Equal(Day.End, hold.Until);
    }

    [Fact]
    public void Security_mail_uses_the_reserve() =>
        Assert.IsType<EmailBudgetDecision.Admit>(Decide(EmailPriority.Security, Daily(80), Monthly(80)));

    [Fact]
    public void The_share_is_the_day_only()
    {
        // 2,900 of 3,000 for the month is past 80% of it, and standard mail
        // still goes: the month is one pool.
        Assert.IsType<EmailBudgetDecision.Admit>(Decide(EmailPriority.Standard, Daily(10), Monthly(2900)));
    }

    [Fact]
    public void No_cap_is_no_cap() =>
        Assert.IsType<EmailBudgetDecision.Admit>(
            Decide(EmailPriority.Standard, Daily(50_000, limit: 0), Monthly(50_000, limit: 0)));

    [Fact]
    public void A_latch_from_the_provider_holds_whatever_the_counts_say()
    {
        var hold = Assert.IsType<EmailBudgetDecision.Hold>(
            Decide(EmailPriority.Security, Daily(3, latch: Day.End), Monthly(3)));

        Assert.Equal(EmailBudget.ProviderQuota, hold.Reason);
        Assert.Equal(Day.End, hold.Until);
    }

    [Fact]
    public void A_latch_that_has_passed_holds_nothing() =>
        Assert.IsType<EmailBudgetDecision.Admit>(
            Decide(EmailPriority.Security, Daily(3, latch: Now.AddMinutes(-1)), Monthly(3)));

    [Theory]
    [InlineData(100, 0.8, 80)]
    [InlineData(2, 0.5, 1)]
    [InlineData(1, 0.8, 1)]
    [InlineData(10, 1.0, 10)]
    [InlineData(0, 0.8, 0)]
    public void The_standard_allowance_is_never_none_when_the_day_allows_any(int limit, double share, int expected) =>
        Assert.Equal(expected, EmailBudget.StandardAllowance(limit, share));

    [Fact]
    public void The_providers_count_wins_when_it_is_larger() =>
        Assert.Equal(40, EmailBudget.Used(12, 40, Now.AddMinutes(-5), Day));

    [Fact]
    public void Our_count_wins_when_it_is_larger() =>
        Assert.Equal(12, EmailBudget.Used(12, 3, Now.AddMinutes(-5), Day));

    [Fact]
    public void A_count_from_before_the_window_is_ignored() =>
        Assert.Equal(12, EmailBudget.Used(12, 99, Day.Start.AddMinutes(-1), Day));

    [Fact]
    public void No_count_from_the_provider_is_ours_alone() =>
        Assert.Equal(12, EmailBudget.Used(12, null, null, Day));
}
