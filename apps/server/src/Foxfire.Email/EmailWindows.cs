namespace Foxfire.Email;

/// <summary>A stretch of time a quota is counted over. <see cref="Start"/> is in it; <see cref="End"/> is not.</summary>
public readonly record struct EmailWindow(DateTimeOffset Start, DateTimeOffset End)
{
    public bool Contains(DateTimeOffset at) => at >= Start && at < End;
}

/// <summary>
/// The two windows a provider's quota is counted over.
///
/// The day is the UTC calendar day, midnight to midnight, because that is the
/// day Resend counts — not a rolling twenty-four hours from the first send. The
/// month starts at midnight UTC on the reset day, which a host sets to their
/// account's billing day; a month without that day starts on its last.
/// </summary>
public static class EmailWindows
{
    public static EmailWindow Day(DateTimeOffset now)
    {
        var utc = now.ToUniversalTime();
        var start = new DateTimeOffset(utc.Year, utc.Month, utc.Day, 0, 0, 0, TimeSpan.Zero);
        return new EmailWindow(start, start.AddDays(1));
    }

    public static EmailWindow Month(DateTimeOffset now, int resetDay)
    {
        resetDay = Math.Clamp(resetDay, 1, 31);
        var utc = now.ToUniversalTime();

        var anchor = Anchor(utc.Year, utc.Month, resetDay);
        if (utc >= anchor)
        {
            var next = utc.AddMonths(1);
            return new EmailWindow(anchor, Anchor(next.Year, next.Month, resetDay));
        }

        var previous = utc.AddMonths(-1);
        return new EmailWindow(Anchor(previous.Year, previous.Month, resetDay), anchor);
    }

    public static EmailWindow Of(QuotaWindow window, DateTimeOffset now, int resetDay) =>
        window == QuotaWindow.Daily ? Day(now) : Month(now, resetDay);

    private static DateTimeOffset Anchor(int year, int month, int resetDay) =>
        new(year, month, Math.Min(resetDay, DateTime.DaysInMonth(year, month)), 0, 0, 0, TimeSpan.Zero);
}
