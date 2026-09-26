using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Telemetry;

/// <summary>
/// A window's worth of points for some metrics, whichever tier each came from.
///
/// Every series is an array with one cell per point, null where nothing was
/// measured. <see cref="Up"/> says, point by point, whether the server was
/// running at all — told by the heartbeat — so a gap where it was down draws as
/// a gap rather than as a quiet hour.
/// </summary>
public sealed class InsightFrame
{
    public InsightFrame(InsightWindow window, DateTimeOffset now)
    {
        Window = window;
        Now = now;
        From = window.From(now);
        Up = new bool[window.Points];
    }

    public InsightWindow Window { get; }

    public DateTimeOffset Now { get; }

    /// <summary>Where the first point starts.</summary>
    public DateTimeOffset From { get; }

    public int Points => Window.Points;

    public bool[] Up { get; }

    public Dictionary<SeriesKey, InsightAggregate?[]> Series { get; } = [];

    /// <summary>Where the history starts, when it starts after the window does. Null when it covers the window.</summary>
    public DateTimeOffset? HistoryFrom
    {
        get
        {
            var first = Array.IndexOf(Up, true);
            return first > 0 ? From + (Window.Step * first) : null;
        }
    }

    /// <summary>Folds a bucket's measurement into the point it falls in. Never keeps the one it was handed.</summary>
    public void Add(SeriesKey key, DateTimeOffset start, InsightAggregate aggregate)
    {
        var index = IndexOf(start);
        if (index < 0) return;

        if (key.Metric == InsightMetrics.Heartbeat) Up[index] = true;

        if (!Series.TryGetValue(key, out var points))
        {
            points = new InsightAggregate?[Points];
            Series[key] = points;
        }

        if (points[index] is { } existing) existing.Merge(aggregate);
        else points[index] = aggregate.Clone();
    }

    /// <summary>A point the running process has in memory, which it was necessarily up for.</summary>
    public void MarkUp(DateTimeOffset start)
    {
        var index = IndexOf(start);
        if (index >= 0) Up[index] = true;
    }

    /// <summary>The series of one metric, with their dimensions split apart, optionally filtered by them.</summary>
    public IEnumerable<(string[] Dimensions, InsightAggregate?[] Points)> Of(
        string metric,
        Func<string[], bool>? where = null)
    {
        foreach (var (key, points) in Series)
        {
            if (key.Metric != metric) continue;

            var dimensions = InsightMetrics.Split(key.Dimensions);
            if (where is null || where(dimensions)) yield return (dimensions, points);
        }
    }

    /// <summary>
    /// One value per point, from the matching series merged together.
    /// A point the server was down for is null; one it was up for with nothing
    /// measured is <paramref name="empty"/>.
    /// </summary>
    public double?[] Values(
        string metric,
        Func<InsightAggregate, double?> read,
        Func<string[], bool>? where = null,
        double? empty = 0)
    {
        ArgumentNullException.ThrowIfNull(read);

        var matching = Of(metric, where).Select(s => s.Points).ToList();
        var values = new double?[Points];

        for (var i = 0; i < Points; i++)
        {
            if (!Up[i]) continue;

            InsightAggregate? merged = null;
            foreach (var points in matching)
            {
                if (points[i] is not { } aggregate) continue;
                if (merged is null) merged = aggregate.Clone();
                else merged.Merge(aggregate);
            }

            values[i] = merged is null ? empty : Round(read(merged));
        }

        return values;
    }

    /// <summary>
    /// A gauge added up across its series, point by point: each series' mean,
    /// summed. What "desktops connected" is when every version is its own series
    /// — merging the samples would average the versions rather than add them.
    /// </summary>
    public double?[] GaugeTotal(string metric, Func<string[], bool>? where = null)
    {
        var matching = Of(metric, where).Select(s => s.Points).ToList();
        var values = new double?[Points];

        for (var i = 0; i < Points; i++)
        {
            if (!Up[i]) continue;

            double total = 0;
            foreach (var points in matching) total += points[i]?.Mean ?? 0;
            values[i] = Round(total);
        }

        return values;
    }

    /// <summary>Everything the matching series measured across the window, merged.</summary>
    public InsightAggregate Total(string metric, Func<string[], bool>? where = null)
    {
        var total = InsightMetrics.Empty(metric);
        foreach (var (_, points) in Of(metric, where))
        {
            foreach (var aggregate in points)
            {
                if (aggregate is not null) total.Merge(aggregate);
            }
        }

        return total;
    }

    /// <summary>Two decimal places: enough for any chart, and a fraction of the JSON.</summary>
    public static double? Round(double? value) => value is { } v ? Math.Round(v, 2) : null;

    private int IndexOf(DateTimeOffset start)
    {
        if (start < From) return -1;

        var index = (int)((start - From).Ticks / Window.Step.Ticks);
        return index < Points ? index : -1;
    }
}

/// <summary>
/// Reads a window of the insights history, from wherever each part of it is.
///
/// Three places, stitched so nothing is counted twice and nothing is missed.
/// Hour rows, for everything folded. Minute rows, for what has not been folded
/// yet or for a window that wants minutes. And memory, for every minute this
/// process has not written down — at least the one still filling, so the last
/// point of any chart is now. The line between the database and memory is
/// <see cref="TelemetryCollector.FlushedThrough"/>.
///
/// With persistence off, memory is all there is, and a window reaches back at
/// most an hour.
/// </summary>
public sealed class InsightsReader(
    FoxfireDbContext db,
    TelemetryBuffer buffer,
    TelemetryCollector collector,
    TimeProvider time)
{
    public async Task<InsightFrame> ReadAsync(
        InsightWindow window,
        IReadOnlyCollection<string> metrics,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(metrics);

        var frame = new InsightFrame(window, time.GetUtcNow());
        HashSet<string> wanted = [.. metrics, InsightMetrics.Heartbeat];

        var stored = collector.Persisting && window.Source != InsightSource.Live;
        var flushed = collector.FlushedThrough;
        var memoryFrom = stored && flushed > frame.From ? flushed : frame.From;

        if (stored) await ReadStoredAsync(frame, wanted, flushed, cancellationToken);

        foreach (var bucket in buffer.Closed(memoryFrom).Append(buffer.Open()))
        {
            if (bucket.Start < memoryFrom) continue;

            frame.MarkUp(bucket.Start);
            foreach (var (key, aggregate) in bucket.Series)
            {
                if (wanted.Contains(key.Metric)) frame.Add(key, bucket.Start, aggregate);
            }
        }

        return frame;
    }

    private async Task ReadStoredAsync(
        InsightFrame frame,
        HashSet<string> wanted,
        DateTimeOffset until,
        CancellationToken cancellationToken)
    {
        if (until <= frame.From) return;

        var minutesFrom = frame.From;
        HashSet<DateTimeOffset> folded = [];

        if (frame.Window.Source == InsightSource.Hours)
        {
            var hours = await TelemetryStore.ReadAsync(
                db, TelemetryResolution.Hour, wanted, frame.From, until, cancellationToken);

            foreach (var row in hours)
            {
                folded.Add(row.BucketStart);
                frame.Add(row.Key, row.BucketStart, row.ToAggregate());
            }

            // Minutes only after the last hour folded: everything before it is
            // in the hours, and minutes are two days of rows a month's window
            // has no use for.
            if (folded.Count > 0) minutesFrom = folded.Max().AddHours(1);
        }

        var minutes = await TelemetryStore.ReadAsync(
            db, TelemetryResolution.Minute, wanted, minutesFrom, until, cancellationToken);

        foreach (var row in minutes)
        {
            if (folded.Contains(InsightWindow.Floor(row.BucketStart, TimeSpan.FromHours(1)))) continue;
            frame.Add(row.Key, row.BucketStart, row.ToAggregate());
        }
    }
}
