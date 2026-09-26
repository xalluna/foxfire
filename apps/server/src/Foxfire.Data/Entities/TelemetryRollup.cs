using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>How much time one rollup row covers.</summary>
public enum TelemetryResolution : byte
{
    Minute = 1,
    Hour = 2
}

/// <summary>
/// One series' measurements over one minute or one hour — what the insights
/// page draws its history from.
///
/// The running server keeps ten-second buckets in memory for the last hour,
/// which is all the fifteen-minute view needs and all a restart loses. Each
/// finished minute is written here as it closes, and each finished hour is
/// folded from its minutes into one row. Minutes are kept for two days and
/// hours for the retention period, so a month of a small community is tens of
/// thousands of rows rather than millions.
///
/// A minute row is written by one process and says which: two processes can
/// write the same minute — the one that stopped part-way through it and the one
/// that started — and a read adds them together, so neither half is lost and
/// neither overwrites the other. An hour row is written once, and a unique index
/// holds it to that.
///
/// Every kind of measurement is the same four numbers — how many, their total,
/// the least and the most — plus, for a duration, how they were spread; see
/// <c>Foxfire.Core.InsightAggregate</c>, which is what reads them back.
/// </summary>
public sealed class TelemetryRollup
{
    /// <summary>Sequential rather than a Guid: this table is nothing but appends, in time order.</summary>
    public long Id { get; set; }

    public TelemetryResolution Resolution { get; set; }

    /// <summary>The start of the minute or hour, in UTC.</summary>
    public DateTimeOffset BucketStart { get; set; }

    /// <summary>What was measured — <c>http.requests</c>, <c>riot.queue_depth</c>.</summary>
    public required string Metric { get; set; }

    /// <summary>
    /// Which series of it, as the dimension values joined with <c>|</c> in the
    /// metric's own order: <c>/api/search|GET|2xx|desktop</c>. Empty for a
    /// metric with none.
    /// </summary>
    public required string Dimensions { get; set; }

    /// <summary>The process that wrote a minute row. Null on an hour row, which is written once.</summary>
    public Guid? Instance { get; set; }

    public long Count { get; set; }

    public double Sum { get; set; }

    public double Min { get; set; }

    public double Max { get; set; }

    /// <summary>A duration's spread, as <c>index:count</c> pairs. Null for a counter or a gauge.</summary>
    public string? Buckets { get; set; }
}

internal sealed class TelemetryRollupConfiguration : IEntityTypeConfiguration<TelemetryRollup>
{
    /// <summary>
    /// Narrow enough that the unique index on hour rows stays under SQL Server's
    /// 1,700-byte key limit with the metric beside it. A route template and
    /// three short values fit several times over; anything longer is trimmed
    /// before it gets here.
    /// </summary>
    public const int DimensionsLength = 256;

    public const int MetricLength = 64;

    public void Configure(EntityTypeBuilder<TelemetryRollup> builder)
    {
        builder.HasKey(r => r.Id);

        builder.Property(r => r.Metric).HasMaxLength(MetricLength).IsUnicode(false);
        builder.Property(r => r.Dimensions).HasMaxLength(DimensionsLength);
        builder.Property(r => r.Buckets).HasMaxLength(512).IsUnicode(false);

        // What every read asks: one resolution, a set of metrics, a span of time.
        builder.HasIndex(r => new { r.Resolution, r.Metric, r.BucketStart });

        // One hour row per series per hour, however many processes try to fold
        // it. Filtered, because minute rows are many per series per minute by
        // design.
        builder.HasIndex(r => new { r.Resolution, r.BucketStart, r.Metric, r.Dimensions })
            .IsUnique()
            .HasFilter("[Resolution] = 2")
            .HasDatabaseName("IX_TelemetryRollups_Hour");
    }
}
