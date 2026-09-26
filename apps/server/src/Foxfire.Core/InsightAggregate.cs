using System.Globalization;
using System.Text;

namespace Foxfire.Core;

/// <summary>
/// One series' measurements over one bucket of time: how many, their total, the
/// smallest and largest, and — for a duration — how they were spread.
///
/// Every metric the server keeps is stored this way, whatever kind it is. A
/// duration counts requests and sums their milliseconds; a counter sums what
/// was added; a gauge sampled every ten seconds sums its samples, so its mean is
/// <see cref="Sum"/> over <see cref="Count"/>. One shape is what lets a ten-second
/// bucket, a minute row and an hour row be folded into each other by the same
/// <see cref="Merge"/>, and read back by the same code whichever tier they came
/// from.
///
/// Not thread-safe. The collector holds a lock around the bucket that is still
/// filling; everything after that is one thread's.
/// </summary>
public sealed class InsightAggregate
{
    /// <summary>
    /// Where one duration bucket ends and the next begins, in milliseconds.
    ///
    /// Fixed, and never to be changed. Stored rows carry counts against these
    /// bounds by position, and thirty days of them are merged into one another
    /// whenever a chart is read — a row counted against different bounds would
    /// merge into nonsense rather than into an error. Wide enough at the top for
    /// a backfill, which takes minutes; fine enough at the bottom for a request
    /// that is answered from memory.
    /// </summary>
    public static readonly IReadOnlyList<double> DurationBounds =
        [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 300_000];

    private long[]? _buckets;

    private InsightAggregate(bool histogram)
    {
        if (histogram) _buckets = new long[DurationBounds.Count + 1];
    }

    /// <summary>A counter or a gauge: totals, with no spread.</summary>
    public static InsightAggregate Plain() => new(histogram: false);

    /// <summary>A duration in milliseconds, whose percentiles are wanted.</summary>
    public static InsightAggregate Duration() => new(histogram: true);

    /// <summary>How many measurements. For a gauge, how many samples.</summary>
    public long Count { get; private set; }

    public double Sum { get; private set; }

    /// <summary>The smallest measurement. Zero while there are none.</summary>
    public double Min { get; private set; }

    /// <summary>The largest measurement. Zero while there are none.</summary>
    public double Max { get; private set; }

    public bool IsDuration => _buckets is not null;

    public double? Mean => Count == 0 ? null : Sum / Count;

    public void Record(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) return;

        if (Count == 0)
        {
            Min = value;
            Max = value;
        }
        else
        {
            if (value < Min) Min = value;
            if (value > Max) Max = value;
        }

        Count++;
        Sum += value;

        if (_buckets is not null) _buckets[BucketOf(value)]++;
    }

    /// <summary>Folds another bucket's measurements into this one.</summary>
    public void Merge(InsightAggregate other)
    {
        ArgumentNullException.ThrowIfNull(other);
        if (other.Count == 0) return;

        if (Count == 0)
        {
            Min = other.Min;
            Max = other.Max;
        }
        else
        {
            Min = Math.Min(Min, other.Min);
            Max = Math.Max(Max, other.Max);
        }

        Count += other.Count;
        Sum += other.Sum;

        if (other._buckets is not null)
        {
            _buckets ??= new long[DurationBounds.Count + 1];
            for (var i = 0; i < _buckets.Length; i++) _buckets[i] += other._buckets[i];
        }
    }

    /// <summary>
    /// The value below which <paramref name="quantile"/> of the measurements fell,
    /// estimated from the buckets.
    ///
    /// Linear within the bucket the rank lands in, and held inside the smallest
    /// and largest actually seen — so a single slow request reads as itself
    /// rather than as the top of a bucket that reaches to five minutes. Null for
    /// anything that was not a duration, or that saw nothing.
    /// </summary>
    public double? Percentile(double quantile)
    {
        if (_buckets is null || Count == 0) return null;

        var rank = Math.Clamp(quantile, 0, 1) * Count;
        long before = 0;

        for (var i = 0; i < _buckets.Length; i++)
        {
            var inBucket = _buckets[i];
            if (inBucket == 0) continue;

            if (before + inBucket >= rank)
            {
                var lower = Math.Max(i == 0 ? 0 : DurationBounds[i - 1], Min);
                var upper = Math.Min(i < DurationBounds.Count ? DurationBounds[i] : Max, Max);
                if (upper < lower) upper = lower;

                var within = (rank - before) / inBucket;
                return Math.Clamp(lower + ((upper - lower) * within), Min, Max);
            }

            before += inBucket;
        }

        return Max;
    }

    /// <summary>
    /// The spread as text, for a row: <c>index:count</c> pairs for the buckets
    /// that saw anything. Null for a counter or a gauge.
    /// </summary>
    public string? EncodeBuckets()
    {
        if (_buckets is null) return null;

        var text = new StringBuilder();
        for (var i = 0; i < _buckets.Length; i++)
        {
            if (_buckets[i] == 0) continue;
            if (text.Length > 0) text.Append(',');
            text.Append(CultureInfo.InvariantCulture, $"{i}:{_buckets[i]}");
        }

        return text.ToString();
    }

    /// <summary>A stored row, read back into something that merges.</summary>
    public static InsightAggregate Restore(long count, double sum, double min, double max, string? buckets)
    {
        var aggregate = new InsightAggregate(histogram: buckets is not null)
        {
            Count = count,
            Sum = sum,
            Min = min,
            Max = max
        };

        if (aggregate._buckets is not null && buckets is not null)
        {
            foreach (var pair in buckets.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var split = pair.Split(':', 2);
                if (split.Length != 2) continue;
                if (!int.TryParse(split[0], NumberStyles.None, CultureInfo.InvariantCulture, out var index)) continue;
                if (!long.TryParse(split[1], NumberStyles.None, CultureInfo.InvariantCulture, out var n)) continue;
                if (index >= 0 && index < aggregate._buckets.Length) aggregate._buckets[index] += n;
            }
        }

        return aggregate;
    }

    /// <summary>A copy that can be merged into without touching this one.</summary>
    public InsightAggregate Clone()
    {
        var copy = new InsightAggregate(histogram: false);
        copy.Merge(this);
        if (_buckets is not null && Count == 0) copy._buckets = new long[_buckets.Length];
        return copy;
    }

    private static int BucketOf(double value)
    {
        for (var i = 0; i < DurationBounds.Count; i++)
        {
            if (value <= DurationBounds[i]) return i;
        }

        return DurationBounds.Count;
    }
}
