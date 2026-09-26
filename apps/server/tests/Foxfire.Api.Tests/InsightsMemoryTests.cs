using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using Serilog;

namespace Foxfire.Api.Tests;

/// <summary>
/// The parts of the insights page that live in memory: the ten-second buckets,
/// the log rings, and the arithmetic that turns buckets into chart points.
/// No server needed.
/// </summary>
public sealed class InsightsMemoryTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 26, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_measurement_lands_in_the_bucket_that_was_open()
    {
        var buffer = new TelemetryBuffer();
        buffer.Begin(T0);

        buffer.Record(InsightMetrics.HttpRequests, "/api/x|GET|2xx|desktop", 12);
        var closed = buffer.Close(T0.AddSeconds(10));

        Assert.NotNull(closed);
        Assert.Equal(T0, closed.Start);
        Assert.Equal(1, closed.Series[new SeriesKey(InsightMetrics.HttpRequests, "/api/x|GET|2xx|desktop")].Count);
        Assert.Empty(buffer.Open().Series);
        Assert.Equal(T0.AddSeconds(10), buffer.OpenStart);
    }

    [Fact]
    public void A_tick_that_has_not_moved_the_clock_closes_nothing()
    {
        var buffer = new TelemetryBuffer();
        buffer.Begin(T0);
        buffer.Record(InsightMetrics.RuntimeCpu, "", 5);

        Assert.Null(buffer.Close(T0));
        Assert.Null(buffer.Close(T0.AddSeconds(-10)));
        Assert.Single(buffer.Open().Series);
    }

    [Fact]
    public void Only_the_last_hour_is_kept()
    {
        var buffer = new TelemetryBuffer();
        buffer.Begin(T0);

        for (var i = 1; i <= 400; i++) buffer.Close(T0.AddSeconds(10 * i));

        var closed = buffer.Closed(DateTimeOffset.MinValue);
        Assert.True(closed.Count <= 361);
        Assert.True(closed[0].Start >= T0.AddSeconds(4000) - InsightWindows.LiveSpan);
    }

    [Fact]
    public void A_metric_with_too_many_series_counts_the_rest_as_other()
    {
        var buffer = new TelemetryBuffer();
        buffer.Begin(T0);

        for (var i = 0; i < InsightMetrics.MaxSeriesPerMetric + 25; i++)
        {
            buffer.Record(InsightMetrics.RuntimeExceptions, $"Type{i}", 1);
        }

        var open = buffer.Open().Series;
        Assert.Equal(InsightMetrics.MaxSeriesPerMetric + 1, open.Count);
        Assert.Equal(25, open[new SeriesKey(InsightMetrics.RuntimeExceptions, InsightMetrics.Other)].Sum);

        // A series seen before the cap keeps its own name afterwards.
        buffer.Record(InsightMetrics.RuntimeExceptions, "Type0", 1);
        Assert.Equal(2, buffer.Open().Series[new SeriesKey(InsightMetrics.RuntimeExceptions, "Type0")].Sum);
    }

    [Fact]
    public void Dimensions_cannot_be_confused_by_a_bar_inside_one()
    {
        var joined = InsightMetrics.Dimensions("/api/a|b", "GET", null);

        Assert.Equal("/api/a/b|GET|", joined);
        Assert.Equal(["/api/a/b", "GET", ""], InsightMetrics.Split(joined));
    }

    [Fact]
    public void A_frame_puts_each_bucket_on_its_point_and_says_where_history_starts()
    {
        var window = InsightWindows.FifteenMinutes;
        var now = T0.AddMinutes(15);
        var frame = new InsightFrame(window, now);

        // Up only for the last two points; a request on the last one.
        var last = frame.From + (window.Step * (window.Points - 1));
        var before = last - window.Step;
        frame.MarkUp(before);
        frame.MarkUp(last);

        var request = InsightAggregate.Duration();
        request.Record(40);
        frame.Add(new SeriesKey(InsightMetrics.HttpRequests, "/a|GET|2xx|web"), last, request);

        var counts = frame.Values(InsightMetrics.HttpRequests, a => a.Count);

        Assert.Null(counts[0]);
        Assert.Equal(0, counts[^2]);
        Assert.Equal(1, counts[^1]);
        Assert.Equal(before, frame.HistoryFrom);

        // The frame kept a copy; the bucket it was handed is untouched.
        frame.Add(new SeriesKey(InsightMetrics.HttpRequests, "/a|GET|2xx|web"), last, request);
        Assert.Equal(1, request.Count);
    }

    [Fact]
    public void Gauges_across_series_add_their_means_rather_than_average_them()
    {
        var frame = new InsightFrame(InsightWindows.FifteenMinutes, T0);
        var point = frame.From;
        frame.MarkUp(point);

        var three = InsightAggregate.Plain();
        three.Record(3);
        three.Record(3);
        var one = InsightAggregate.Plain();
        one.Record(1);

        frame.Add(new SeriesKey(InsightMetrics.ClientsConnected, "desktop|0.15.0"), point, three);
        frame.Add(new SeriesKey(InsightMetrics.ClientsConnected, "desktop|0.16.0"), point, one);

        // Three desktops on one version and one on the other are four desktops,
        // not the 2.33 their samples average to.
        Assert.Equal(4, frame.GaugeTotal(InsightMetrics.ClientsConnected)[0]);
        Assert.Equal(2.33, frame.Values(InsightMetrics.ClientsConnected, a => a.Mean)[0]);
    }

    [Fact]
    public void Recent_logs_keep_problems_apart_from_the_chatter()
    {
        var logs = new RecentLogs();
        using var logger = new LoggerConfiguration().WriteTo.Sink(logs).CreateLogger();

        logger.Warning("The one worth seeing {Marker}", "needle");
        for (var i = 0; i < RecentLogs.AllCapacity + 10; i++) logger.Information("Chatter {Index}", i);
        logger.Debug("Never kept");

        var everything = logs.Read(null, PageRequest.Of(10, 0), before: null);
        var problems = logs.Read("warning", PageRequest.Of(10, 0), before: null);

        Assert.Equal(RecentLogs.AllCapacity, everything.Total);
        Assert.DoesNotContain(everything.Items, e => e.Level == "warning");

        var warning = Assert.Single(problems.Items);
        Assert.Equal("The one worth seeing \"needle\"", warning.Message);
        Assert.Equal(1, logs.Counts()["warning"]);
        Assert.Equal(RecentLogs.AllCapacity + 10, logs.Counts()["information"]);
    }

    [Fact]
    public void A_later_page_is_pinned_to_where_the_first_began()
    {
        var logs = new RecentLogs();
        using var logger = new LoggerConfiguration().WriteTo.Sink(logs).CreateLogger();

        for (var i = 0; i < 5; i++) logger.Error("Line {Index}", i);

        var first = logs.Read("error", PageRequest.Of(2, 0), before: null);
        var anchor = first.Items[0].Seq + 1;

        // Two more arrive while the first page is on screen.
        logger.Error("Late {Index}", 5);
        logger.Error("Late {Index}", 6);

        var second = logs.Read("error", PageRequest.Of(2, 2), anchor);

        Assert.Equal(["Line 4", "Line 3"], first.Items.Select(e => e.Message));
        Assert.Equal(["Line 2", "Line 1"], second.Items.Select(e => e.Message));
        Assert.Equal(5, second.Total);
    }

    [Fact]
    public void A_negative_insights_retention_is_refused()
    {
        var problems = ConfigurationCheck.Validate(
            "Server=db;Database=Foxfire",
            new ServerOptions { PublicUrl = "https://foxfire.example.com" },
            new RiotOptions { ApiKey = "RGAPI-test" },
            new AuthOptions
            {
                JwtSigningKey = "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=",
                InviteSigningKey = "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg="
            },
            new AdminOptions { Email = "admin@example.com" },
            new RateLimitOptions(),
            new LogOptions(),
            new TelemetryOptions { RetentionDays = -1 });

        Assert.Contains(problems, p => p.StartsWith("Telemetry__RetentionDays", StringComparison.Ordinal));
    }
}
