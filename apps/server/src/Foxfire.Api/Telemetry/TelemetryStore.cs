using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Telemetry;

/// <summary>One stored rollup, as a read wants it.</summary>
public readonly record struct RollupRow(
    DateTimeOffset BucketStart,
    string Metric,
    string Dimensions,
    long Count,
    double Sum,
    double Min,
    double Max,
    string? Buckets)
{
    public SeriesKey Key => new(Metric, Dimensions);

    public InsightAggregate ToAggregate() => InsightAggregate.Restore(Count, Sum, Min, Max, Buckets);
}

/// <summary>
/// Writing the insights history down, folding it, and trimming it.
///
/// Static and handed its context, so the tests can drive each step at a moment
/// of their choosing rather than waiting for the collector's clock to reach it.
/// </summary>
public static class TelemetryStore
{
    /// <summary>One finished minute, as this process saw it.</summary>
    public static async Task FlushAsync(
        FoxfireDbContext db,
        Guid instance,
        DateTimeOffset minute,
        IReadOnlyDictionary<SeriesKey, InsightAggregate> series,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(series);

        foreach (var (key, aggregate) in series)
        {
            if (aggregate.Count == 0) continue;
            db.TelemetryRollups.Add(Row(TelemetryResolution.Minute, minute, key, aggregate, instance));
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Folds one hour's minutes into hour rows, unless it has been folded
    /// already. Answers whether this call did the folding.
    ///
    /// The minutes are left where they are — the two-day views still read them
    /// — and are pruned on their own schedule. Two processes folding the same
    /// hour at once is settled by the unique index: the loser's rows are refused
    /// whole and the winner's stand.
    /// </summary>
    public static async Task<bool> FoldHourAsync(
        FoxfireDbContext db,
        DateTimeOffset hour,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var end = hour.AddHours(1);

        var folded = await db.TelemetryRollups
            .AnyAsync(r => r.Resolution == TelemetryResolution.Hour && r.BucketStart == hour, cancellationToken);
        if (folded) return false;

        var minutes = await ReadAsync(db, TelemetryResolution.Minute, null, hour, end, cancellationToken);
        if (minutes.Count == 0) return false;

        foreach (var (key, aggregate) in Merge(minutes))
        {
            db.TelemetryRollups.Add(Row(TelemetryResolution.Hour, hour, key, aggregate, instance: null));
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            // Another process folded it between the check and the write. Its
            // rows are the same rows.
            db.ChangeTracker.Clear();
            return false;
        }
    }

    /// <summary>
    /// The hours between <paramref name="from"/> and <paramref name="until"/>
    /// that have minutes but no hour rows yet, oldest first.
    /// </summary>
    public static async Task<IReadOnlyList<DateTimeOffset>> UnfoldedHoursAsync(
        FoxfireDbContext db,
        DateTimeOffset from,
        DateTimeOffset until,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var folded = (await db.TelemetryRollups
                .Where(r => r.Resolution == TelemetryResolution.Hour && r.BucketStart >= from && r.BucketStart < until)
                .Select(r => r.BucketStart)
                .Distinct()
                .ToListAsync(cancellationToken))
            .ToHashSet();

        List<DateTimeOffset> hours = [];
        for (var hour = InsightWindow.Floor(from, TimeSpan.FromHours(1)); hour < until; hour = hour.AddHours(1))
        {
            if (folded.Contains(hour)) continue;

            var end = hour.AddHours(1);
            var any = await db.TelemetryRollups.AnyAsync(
                r => r.Resolution == TelemetryResolution.Minute && r.BucketStart >= hour && r.BucketStart < end,
                cancellationToken);

            if (any) hours.Add(hour);
        }

        return hours;
    }

    /// <summary>
    /// Drops minutes older than <paramref name="minutesBefore"/>, and hours
    /// older than <paramref name="hoursBefore"/> when there is a limit on them.
    /// </summary>
    public static async Task<int> PruneAsync(
        FoxfireDbContext db,
        DateTimeOffset minutesBefore,
        DateTimeOffset? hoursBefore,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var removed = await db.TelemetryRollups
            .Where(r => r.Resolution == TelemetryResolution.Minute && r.BucketStart < minutesBefore)
            .ExecuteDeleteAsync(cancellationToken);

        if (hoursBefore is { } cutoff)
        {
            removed += await db.TelemetryRollups
                .Where(r => r.Resolution == TelemetryResolution.Hour && r.BucketStart < cutoff)
                .ExecuteDeleteAsync(cancellationToken);
        }

        return removed;
    }

    /// <summary>Rows of one resolution in <c>[from, until)</c>, for the metrics named, or for all of them.</summary>
    public static async Task<List<RollupRow>> ReadAsync(
        FoxfireDbContext db,
        TelemetryResolution resolution,
        IReadOnlyCollection<string>? metrics,
        DateTimeOffset from,
        DateTimeOffset until,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(db);

        var query = db.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.Resolution == resolution && r.BucketStart >= from && r.BucketStart < until);

        if (metrics is not null) query = query.Where(r => metrics.Contains(r.Metric));

        return await query
            .Select(r => new RollupRow(r.BucketStart, r.Metric, r.Dimensions, r.Count, r.Sum, r.Min, r.Max, r.Buckets))
            .ToListAsync(cancellationToken);
    }

    /// <summary>Rows added together by series, whatever bucket they are from.</summary>
    public static Dictionary<SeriesKey, InsightAggregate> Merge(IEnumerable<RollupRow> rows)
    {
        ArgumentNullException.ThrowIfNull(rows);

        Dictionary<SeriesKey, InsightAggregate> merged = [];
        foreach (var row in rows)
        {
            if (merged.TryGetValue(row.Key, out var aggregate)) aggregate.Merge(row.ToAggregate());
            else merged[row.Key] = row.ToAggregate();
        }

        return merged;
    }

    private static TelemetryRollup Row(
        TelemetryResolution resolution,
        DateTimeOffset start,
        SeriesKey key,
        InsightAggregate aggregate,
        Guid? instance) => new()
        {
            Resolution = resolution,
            BucketStart = start,
            Metric = key.Metric,
            Dimensions = key.Dimensions,
            Instance = instance,
            Count = aggregate.Count,
            Sum = aggregate.Sum,
            Min = aggregate.Min,
            Max = aggregate.Max,
            Buckets = aggregate.EncodeBuckets()
        };
}
