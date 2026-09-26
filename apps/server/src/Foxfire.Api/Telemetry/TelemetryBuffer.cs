using Foxfire.Core;

namespace Foxfire.Api.Telemetry;

/// <summary>Ten seconds of every series, closed.</summary>
public sealed record LiveBucket(DateTimeOffset Start, IReadOnlyDictionary<SeriesKey, InsightAggregate> Series);

/// <summary>
/// The last hour of measurements, in memory, ten seconds at a time.
///
/// Measurements arrive from wherever they happen — a request finishing, a Riot
/// call coming back, a sync ending — and are added to the bucket that is still
/// open, under one lock and without reading the clock. The collector closes that
/// bucket every ten seconds and opens the next; closed buckets are never written
/// again, so readers can take them without copying.
///
/// This is all the fifteen-minute view reads, and the part of every longer view
/// that has not reached the database yet. It is lost on a restart, which is why
/// every finished minute is written down.
/// </summary>
public sealed class TelemetryBuffer
{
    private readonly Lock _gate = new();
    private readonly Queue<LiveBucket> _closed = new();
    private readonly Dictionary<string, HashSet<string>> _seen = [];
    private Dictionary<SeriesKey, InsightAggregate> _open = [];
    private DateTimeOffset _openStart;

    /// <summary>When the bucket still filling began.</summary>
    public DateTimeOffset OpenStart
    {
        get { lock (_gate) return _openStart; }
    }

    /// <summary>Where the first bucket starts. Called once, by the collector, before anything is closed.</summary>
    public void Begin(DateTimeOffset start)
    {
        lock (_gate) _openStart = start;
    }

    /// <summary>One measurement, into the bucket that is filling.</summary>
    public void Record(string metric, string dimensions, double value)
    {
        lock (_gate)
        {
            var key = new SeriesKey(metric, Capped(metric, dimensions));

            if (!_open.TryGetValue(key, out var aggregate))
            {
                aggregate = InsightMetrics.Empty(metric);
                _open[key] = aggregate;
            }

            aggregate.Record(value);
        }
    }

    /// <summary>
    /// Closes the bucket that was filling and opens one starting at
    /// <paramref name="next"/>. Answers the bucket closed, or null when the
    /// clock has not moved past the one open — a tick that came early, or a
    /// clock stepped backwards, which is left to catch up rather than trusted.
    /// </summary>
    public LiveBucket? Close(DateTimeOffset next)
    {
        lock (_gate)
        {
            if (next <= _openStart) return null;

            var closed = new LiveBucket(_openStart, _open);
            _closed.Enqueue(closed);
            _open = [];
            _openStart = next;

            while (_closed.Count > 0 && _closed.Peek().Start < next - InsightWindows.LiveSpan)
            {
                _closed.Dequeue();
            }

            return closed;
        }
    }

    /// <summary>The closed buckets starting at or after <paramref name="from"/>, oldest first.</summary>
    public IReadOnlyList<LiveBucket> Closed(DateTimeOffset from)
    {
        lock (_gate) return [.. _closed.Where(b => b.Start >= from)];
    }

    /// <summary>A copy of the bucket still filling, so the newest point on a chart is now rather than ten seconds ago.</summary>
    public LiveBucket Open()
    {
        lock (_gate)
        {
            return new LiveBucket(_openStart, _open.ToDictionary(p => p.Key, p => p.Value.Clone()));
        }
    }

    /// <summary>
    /// The dimensions a measurement is kept under: its own, until the metric has
    /// <see cref="InsightMetrics.MaxSeriesPerMetric"/> of them, and
    /// <see cref="InsightMetrics.Other"/> after. Caller holds the lock.
    /// </summary>
    private string Capped(string metric, string dimensions)
    {
        if (!_seen.TryGetValue(metric, out var known))
        {
            known = [];
            _seen[metric] = known;
        }

        if (known.Contains(dimensions)) return dimensions;
        if (known.Count >= InsightMetrics.MaxSeriesPerMetric) return InsightMetrics.Other;

        known.Add(dimensions);
        return dimensions;
    }
}
