using Foxfire.Api.Common;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using Foxfire.Riot;
using static Foxfire.Api.Features.Insights.InsightsShapes;

namespace Foxfire.Api.Features.Insights;

/// <summary>One Riot endpoint, over the window. Every attempt counts, retries included.</summary>
/// <param name="Errors">Attempts that failed for any reason but a 404 or a 429, which have their own columns.</param>
public sealed record InsightsEndpointStat(
    string Endpoint,
    long Calls,
    long Errors,
    long Throttled,
    long NotFound,
    double? P50Ms,
    double? P95Ms);

/// <summary>How long one class of work waited for the shared queue.</summary>
public sealed record InsightsPriorityStat(string Priority, long Requests, double? WaitP50Ms, double? WaitP95Ms);

/// <summary>One of the key's two windows, now.</summary>
/// <param name="Name">burst or sustained.</param>
public sealed record InsightsRiotWindow(string Name, int Used, int Limit, double WindowSeconds);

/// <param name="PausedUntil">When a 429 or a 5xx has the queue held, until when, in epoch milliseconds.</param>
/// <param name="Depths">Waiting now, by class.</param>
public sealed record InsightsRiotNow(
    bool KeyRejected,
    long? PausedUntil,
    IReadOnlyList<InsightsRiotWindow> Windows,
    IReadOnlyDictionary<string, int> Depths);

/// <param name="Outcomes">Attempts per point, by outcome: ok, not_found, throttled, server_error, client_error, key_rejected, network.</param>
/// <param name="Usage">The most of each window seen spent in a point: burst and sustained.</param>
/// <param name="Depth">The deepest each class's queue got in a point.</param>
/// <param name="Latency">p50 and p95 on the wire per point, in milliseconds.</param>
public sealed record InsightsRiotResponse(
    InsightsFrameResponse Frame,
    long Total,
    long Throttled,
    IReadOnlyList<InsightSeriesResponse> Outcomes,
    IReadOnlyList<InsightSeriesResponse> Usage,
    IReadOnlyList<InsightSeriesResponse> Depth,
    IReadOnlyList<InsightSeriesResponse> Latency,
    IReadOnlyList<InsightsEndpointStat> Endpoints,
    IReadOnlyList<InsightsPriorityStat> Priorities,
    InsightsRiotNow Now);

/// <summary>What the server has asked of Riot, and how much of the key it has spent doing it.</summary>
public sealed record GetInsightsRiotRequest(string? Window) : IDomainRequest<InsightsRiotResponse>;

internal sealed class GetInsightsRiotRequestHandler(
    InsightsReader reader,
    TelemetryCollector collector,
    RiotRateLimiter limiter)
    : IDomainRequestHandler<GetInsightsRiotRequest, InsightsRiotResponse>
{
    private static readonly string[] Metrics =
    [
        InsightMetrics.RiotRequests,
        InsightMetrics.RiotQueueWait,
        InsightMetrics.RiotQueueDepth,
        InsightMetrics.RiotWindowUsage
    ];

    private static readonly string[] OutcomeOrder =
        ["ok", "not_found", "throttled", "server_error", "client_error", "key_rejected", "network", "canceled"];

    public async Task<Response<InsightsRiotResponse>> Handle(
        GetInsightsRiotRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (InsightWindows.Parse(request.Window) is not { } window)
        {
            return InvalidWindow<InsightsRiotResponse>(request.Window);
        }

        var frame = await reader.ReadAsync(window, Metrics, cancellationToken);
        var total = frame.Total(InsightMetrics.RiotRequests);

        var seen = frame.Of(InsightMetrics.RiotRequests).Select(s => At(s.Dimensions, 1)).ToHashSet();
        var outcomes = OutcomeOrder
            .Where(o => o == "ok" || o == "throttled" || seen.Contains(o))
            .Select(o => Series(o, frame.Values(InsightMetrics.RiotRequests, Count, d => At(d, 1) == o)))
            .ToList();

        var endpoints = frame.Of(InsightMetrics.RiotRequests)
            .GroupBy(s => At(s.Dimensions, 0))
            .Select(group =>
            {
                var endpoint = group.Key;
                var all = frame.Total(InsightMetrics.RiotRequests, d => At(d, 0) == endpoint);
                long Outcome(string o) =>
                    frame.Total(InsightMetrics.RiotRequests, d => At(d, 0) == endpoint && At(d, 1) == o).Count;

                var throttled = Outcome("throttled");
                var notFound = Outcome("not_found");

                return new InsightsEndpointStat(
                    endpoint,
                    all.Count,
                    all.Count - Outcome("ok") - throttled - notFound,
                    throttled,
                    notFound,
                    Round(all.Percentile(0.5)),
                    Round(all.Percentile(0.95)));
            })
            .Where(e => e.Calls > 0)
            .OrderByDescending(e => e.Calls)
            .ThenBy(e => e.Endpoint, StringComparer.Ordinal)
            .ToList();

        var priorities = Enum.GetValues<RiotRequestPriority>()
            .Select(RiotMetrics.PriorityName)
            .Select(priority =>
            {
                var waits = frame.Total(InsightMetrics.RiotQueueWait, d => At(d, 0) == priority);
                return new InsightsPriorityStat(
                    priority, waits.Count, Round(waits.Percentile(0.5)), Round(waits.Percentile(0.95)));
            })
            .ToList();

        var snapshot = limiter.Snapshot();
        var limits = snapshot.Limits;

        var now = new InsightsRiotNow(
            snapshot.KeyRejected,
            snapshot.PausedUntil?.ToUnixTimeMilliseconds(),
            [
                new InsightsRiotWindow("burst", snapshot.BurstUsed, limits.BurstLimit, limits.BurstWindow.TotalSeconds),
                new InsightsRiotWindow(
                    "sustained", snapshot.SustainedUsed, limits.SustainedLimit, limits.SustainedWindow.TotalSeconds)
            ],
            Enum.GetValues<RiotRequestPriority>().ToDictionary(RiotMetrics.PriorityName, p => snapshot.Depths[(int)p]));

        return new InsightsRiotResponse(
            Frame(frame, collector.StartedAt),
            total.Count,
            frame.Total(InsightMetrics.RiotRequests, d => At(d, 1) == "throttled").Count,
            outcomes,
            [
                Series("burst", frame.Values(InsightMetrics.RiotWindowUsage, Max, d => At(d, 0) == "burst", empty: null)),
                Series("sustained", frame.Values(InsightMetrics.RiotWindowUsage, Max, d => At(d, 0) == "sustained", empty: null))
            ],
            [
                .. Enum.GetValues<RiotRequestPriority>()
                    .Select(RiotMetrics.PriorityName)
                    .Select(p => Series(p, frame.Values(InsightMetrics.RiotQueueDepth, Max, d => At(d, 0) == p, empty: null)))
            ],
            [
                Series("p50", frame.Values(InsightMetrics.RiotRequests, P50, empty: null)),
                Series("p95", frame.Values(InsightMetrics.RiotRequests, P95, empty: null))
            ],
            endpoints,
            priorities,
            now);
    }
}
