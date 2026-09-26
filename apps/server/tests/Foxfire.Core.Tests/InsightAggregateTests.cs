namespace Foxfire.Core.Tests;

public sealed class InsightAggregateTests
{
    [Fact]
    public void A_duration_counts_sums_and_bounds_what_it_saw()
    {
        var latency = InsightAggregate.Duration();
        foreach (var ms in new[] { 12.0, 3.0, 40.0 }) latency.Record(ms);

        Assert.Equal(3, latency.Count);
        Assert.Equal(55, latency.Sum);
        Assert.Equal(3, latency.Min);
        Assert.Equal(40, latency.Max);
        Assert.Equal(55.0 / 3, latency.Mean);
    }

    [Fact]
    public void Nothing_seen_has_no_percentile_and_no_mean()
    {
        var latency = InsightAggregate.Duration();

        Assert.Null(latency.Percentile(0.95));
        Assert.Null(latency.Mean);
    }

    [Fact]
    public void A_gauge_has_a_mean_but_no_percentile()
    {
        var depth = InsightAggregate.Plain();
        depth.Record(4);
        depth.Record(6);

        Assert.Equal(5, depth.Mean);
        Assert.Null(depth.Percentile(0.5));
        Assert.Null(depth.EncodeBuckets());
    }

    [Fact]
    public void A_percentile_stays_inside_what_was_actually_seen()
    {
        // One request, in a bucket that reaches from 250 to 500 ms. Its p95 is
        // itself, not the top of the bucket.
        var latency = InsightAggregate.Duration();
        latency.Record(300);

        Assert.Equal(300, latency.Percentile(0.95));
        Assert.Equal(300, latency.Percentile(0.5));
    }

    [Fact]
    public void Percentiles_split_a_spread_the_way_it_fell()
    {
        var latency = InsightAggregate.Duration();
        for (var i = 0; i < 90; i++) latency.Record(20);
        for (var i = 0; i < 10; i++) latency.Record(2_000);

        var p50 = latency.Percentile(0.5)!.Value;
        var p95 = latency.Percentile(0.95)!.Value;

        Assert.InRange(p50, 10, 25);
        Assert.InRange(p95, 1_000, 2_000);
        Assert.Equal(2_000, latency.Percentile(1));
    }

    [Fact]
    public void Merging_is_the_same_as_having_seen_everything_at_once()
    {
        double[] first = [1, 7, 30, 120];
        double[] second = [5, 900, 45_000];

        var a = InsightAggregate.Duration();
        foreach (var v in first) a.Record(v);
        var b = InsightAggregate.Duration();
        foreach (var v in second) b.Record(v);

        var together = InsightAggregate.Duration();
        foreach (var v in first.Concat(second)) together.Record(v);

        a.Merge(b);

        Assert.Equal(together.Count, a.Count);
        Assert.Equal(together.Sum, a.Sum);
        Assert.Equal(together.Min, a.Min);
        Assert.Equal(together.Max, a.Max);
        Assert.Equal(together.EncodeBuckets(), a.EncodeBuckets());
        Assert.Equal(together.Percentile(0.95), a.Percentile(0.95));
    }

    [Fact]
    public void Merging_into_nothing_takes_the_other_bounds()
    {
        var empty = InsightAggregate.Plain();
        var seen = InsightAggregate.Plain();
        seen.Record(-3);
        seen.Record(9);

        empty.Merge(seen);

        Assert.Equal(-3, empty.Min);
        Assert.Equal(9, empty.Max);
    }

    [Fact]
    public void A_stored_row_reads_back_to_the_same_spread()
    {
        var latency = InsightAggregate.Duration();
        foreach (var ms in new[] { 0.4, 3.0, 3.5, 700.0, 400_000.0 }) latency.Record(ms);

        var encoded = latency.EncodeBuckets();
        var restored = InsightAggregate.Restore(latency.Count, latency.Sum, latency.Min, latency.Max, encoded);

        Assert.Equal("0:1,2:2,9:1,16:1", encoded);
        Assert.Equal(encoded, restored.EncodeBuckets());
        Assert.Equal(latency.Percentile(0.9), restored.Percentile(0.9));
    }

    [Fact]
    public void A_clone_is_not_the_original()
    {
        var latency = InsightAggregate.Duration();
        latency.Record(10);

        var copy = latency.Clone();
        copy.Record(20);

        Assert.Equal(1, latency.Count);
        Assert.Equal(2, copy.Count);
        Assert.True(copy.IsDuration);
    }

    [Fact]
    public void Measurements_that_are_not_numbers_are_ignored()
    {
        var gauge = InsightAggregate.Plain();
        gauge.Record(double.NaN);
        gauge.Record(double.PositiveInfinity);

        Assert.Equal(0, gauge.Count);
    }
}
