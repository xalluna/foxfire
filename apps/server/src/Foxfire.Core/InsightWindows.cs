namespace Foxfire.Core;

/// <summary>Where a window's numbers are read from.</summary>
public enum InsightSource
{
    /// <summary>The ten-second buckets the running process holds. Gone on a restart.</summary>
    Live,

    /// <summary>Minute rows, kept for two days, plus what is still in memory.</summary>
    Minutes,

    /// <summary>Hour rows, kept for the retention period, plus the minutes not folded yet.</summary>
    Hours
}

/// <summary>
/// One of the spans the insights page can show, and how finely.
/// </summary>
/// <param name="Key">How a client asks for it: <c>15m</c>, <c>1h</c>, <c>30d</c>.</param>
/// <param name="Step">One point on a chart. Every bucket of the source divides into it.</param>
public sealed record InsightWindow(string Key, TimeSpan Span, TimeSpan Step, InsightSource Source)
{
    /// <summary>How many points a chart of this window has.</summary>
    public int Points => (int)(Span.Ticks / Step.Ticks);

    /// <summary>
    /// Where the first point starts, for a window ending at <paramref name="now"/>.
    ///
    /// The last point is the step <paramref name="now"/> falls in, still filling,
    /// so the right-hand end of every chart is live rather than a step behind.
    /// </summary>
    public DateTimeOffset From(DateTimeOffset now) => Floor(now, Step) - (Step * (Points - 1));

    /// <summary>The start of the step a moment falls in, in UTC.</summary>
    public static DateTimeOffset Floor(DateTimeOffset at, TimeSpan step)
    {
        var ticks = at.UtcTicks;
        return new DateTimeOffset(ticks - (ticks % step.Ticks), TimeSpan.Zero);
    }
}

/// <summary>
/// The spans the insights page offers.
///
/// Each is drawn in at most 360 points, which is about as many as a chart can
/// show one to a pixel and fewer than would make a five-second refresh heavy.
/// So the step widens with the span, and the source follows the step: fifteen
/// minutes is ten-second buckets straight out of memory, a day is minute rows
/// taken five at a time, a month is hour rows two at a time.
/// </summary>
public static class InsightWindows
{
    public static readonly InsightWindow FifteenMinutes =
        new("15m", TimeSpan.FromMinutes(15), TimeSpan.FromSeconds(10), InsightSource.Live);

    public static readonly InsightWindow OneHour =
        new("1h", TimeSpan.FromHours(1), TimeSpan.FromMinutes(1), InsightSource.Minutes);

    public static readonly InsightWindow SixHours =
        new("6h", TimeSpan.FromHours(6), TimeSpan.FromMinutes(1), InsightSource.Minutes);

    public static readonly InsightWindow OneDay =
        new("24h", TimeSpan.FromHours(24), TimeSpan.FromMinutes(5), InsightSource.Minutes);

    public static readonly InsightWindow TwoDays =
        new("48h", TimeSpan.FromHours(48), TimeSpan.FromMinutes(10), InsightSource.Minutes);

    public static readonly InsightWindow OneWeek =
        new("7d", TimeSpan.FromDays(7), TimeSpan.FromHours(1), InsightSource.Hours);

    public static readonly InsightWindow OneMonth =
        new("30d", TimeSpan.FromDays(30), TimeSpan.FromHours(2), InsightSource.Hours);

    public static readonly IReadOnlyList<InsightWindow> All =
        [FifteenMinutes, OneHour, SixHours, OneDay, TwoDays, OneWeek, OneMonth];

    /// <summary>What a caller that asks for nothing gets.</summary>
    public static InsightWindow Default => OneHour;

    /// <summary>The ten seconds live buckets are kept at.</summary>
    public static readonly TimeSpan LiveStep = TimeSpan.FromSeconds(10);

    /// <summary>How long the running process keeps its ten-second buckets.</summary>
    public static readonly TimeSpan LiveSpan = TimeSpan.FromHours(1);

    /// <summary>How long minute rows are kept before only their hours remain.</summary>
    public static readonly TimeSpan MinuteSpan = TimeSpan.FromHours(48);

    /// <summary>
    /// The window a key names. Nothing asked for is <see cref="Default"/>;
    /// something asked for that is not a window is null, and refused.
    /// </summary>
    public static InsightWindow? Parse(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return Default;
        return All.FirstOrDefault(w => string.Equals(w.Key, key.Trim(), StringComparison.OrdinalIgnoreCase));
    }
}
