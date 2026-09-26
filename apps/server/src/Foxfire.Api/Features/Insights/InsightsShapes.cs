using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Telemetry;
using Foxfire.Core;

namespace Foxfire.Api.Features.Insights;

/// <summary>
/// Where a response's points sit in time. Every series in the response has
/// <paramref name="Points"/> values, the first at <paramref name="From"/> and one
/// every <paramref name="StepMs"/> after it.
///
/// Series are bounded by the window rather than paged: a window is at most 360
/// points, whatever it covers, and a chart needs all of them.
/// </summary>
/// <param name="Up">Point by point, whether the server was running. A point it was not is null in every series.</param>
/// <param name="HistoryFrom">Where the history starts, when that is after the window does — a fresh install, or a trimmed month.</param>
public sealed record InsightsFrameResponse(
    string Window,
    long From,
    long StepMs,
    int Points,
    long Now,
    long? HistoryFrom,
    long StartedAt,
    IReadOnlyList<bool> Up);

/// <summary>One line on a chart: a key the client names it by, and a value per point.</summary>
public sealed record InsightSeriesResponse(string Key, IReadOnlyList<double?> Values);

internal static class InsightsShapes
{
    public static readonly Func<InsightAggregate, double?> Count = a => a.Count;
    public static readonly Func<InsightAggregate, double?> Sum = a => a.Sum;
    public static readonly Func<InsightAggregate, double?> Mean = a => a.Mean;
    public static readonly Func<InsightAggregate, double?> Max = a => a.Count == 0 ? null : a.Max;
    public static readonly Func<InsightAggregate, double?> P50 = a => a.Percentile(0.5);
    public static readonly Func<InsightAggregate, double?> P95 = a => a.Percentile(0.95);

    public static InsightsFrameResponse Frame(InsightFrame frame, DateTimeOffset startedAt) => new(
        frame.Window.Key,
        frame.From.ToUnixTimeMilliseconds(),
        (long)frame.Window.Step.TotalMilliseconds,
        frame.Points,
        frame.Now.ToUnixTimeMilliseconds(),
        frame.HistoryFrom?.ToUnixTimeMilliseconds(),
        startedAt.ToUnixTimeMilliseconds(),
        frame.Up);

    public static InsightSeriesResponse Series(string key, double?[] values) => new(key, values);

    /// <summary>Two places, for the numbers a table shows.</summary>
    public static double? Round(double? value) => InsightFrame.Round(value);

    /// <summary>What a window that is not one is answered with.</summary>
    public static Response<T> InvalidWindow<T>(string? key) => Response<T>.Failure(
        new Error(
            "invalid_window",
            $"There is no window '{key}'. Ask for one of {string.Join(", ", InsightWindows.All.Select(w => w.Key))}."),
        HttpStatusCode.BadRequest);

    /// <summary>A dimension by position, or empty when the series was folded into "other".</summary>
    public static string At(string[] dimensions, int index) =>
        index < dimensions.Length ? dimensions[index] : "";
}
