using Foxfire.Api.Common;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using static Foxfire.Api.Features.Insights.InsightsShapes;

namespace Foxfire.Api.Features.Insights;

/// <summary>One route, over the window.</summary>
/// <param name="Route">The route's template — <c>/api/riot-accounts/{id}/matches</c> — or <c>(static)</c> for the web client's files.</param>
public sealed record InsightsRouteStat(
    string Route,
    string Method,
    long Count,
    long ClientErrors,
    long ServerErrors,
    double? P50Ms,
    double? P95Ms,
    double? MaxMs);

/// <summary>One kind of client, over the window.</summary>
/// <param name="Kind">desktop, web, or unnamed for anything that did not say.</param>
public sealed record InsightsClientStat(string Kind, long Count, double? P95Ms);

/// <param name="ByStatus">Requests per point, by status class: 2xx, 3xx, 4xx, 5xx.</param>
/// <param name="Latency">p50 and p95 per point, in milliseconds.</param>
/// <param name="RateLimited">Requests turned away per point, by policy.</param>
/// <param name="Routes">The busiest routes, at most <see cref="GetInsightsRequestsRequestHandler.RouteLimit"/>.</param>
public sealed record InsightsRequestsResponse(
    InsightsFrameResponse Frame,
    long Total,
    double? P50Ms,
    double? P95Ms,
    IReadOnlyList<InsightSeriesResponse> ByStatus,
    IReadOnlyList<InsightSeriesResponse> Latency,
    IReadOnlyList<InsightSeriesResponse> RateLimited,
    IReadOnlyList<InsightsRouteStat> Routes,
    IReadOnlyList<InsightsClientStat> Clients);

/// <summary>What the API has been asked, how it answered, and how quickly.</summary>
public sealed record GetInsightsRequestsRequest(string? Window) : IDomainRequest<InsightsRequestsResponse>;

internal sealed class GetInsightsRequestsRequestHandler(InsightsReader reader, TelemetryCollector collector)
    : IDomainRequestHandler<GetInsightsRequestsRequest, InsightsRequestsResponse>
{
    /// <summary>A table's worth. The busiest are the ones a host is looking for.</summary>
    public const int RouteLimit = 50;

    private static readonly string[] Metrics = [InsightMetrics.HttpRequests, InsightMetrics.HttpRateLimited];

    private static readonly string[] StatusClasses = ["2xx", "3xx", "4xx", "5xx"];

    public async Task<Response<InsightsRequestsResponse>> Handle(
        GetInsightsRequestsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (InsightWindows.Parse(request.Window) is not { } window)
        {
            return InvalidWindow<InsightsRequestsResponse>(request.Window);
        }

        var frame = await reader.ReadAsync(window, Metrics, cancellationToken);
        var total = frame.Total(InsightMetrics.HttpRequests);

        var routes = frame.Of(InsightMetrics.HttpRequests)
            .GroupBy(s => (Route: At(s.Dimensions, 0), Method: At(s.Dimensions, 1)))
            .Select(group =>
            {
                var all = InsightAggregate.Duration();
                long clientErrors = 0;
                long serverErrors = 0;

                foreach (var (dimensions, points) in group)
                {
                    var series = InsightAggregate.Duration();
                    foreach (var point in points)
                    {
                        if (point is not null) series.Merge(point);
                    }

                    all.Merge(series);
                    if (At(dimensions, 2) == "4xx") clientErrors += series.Count;
                    if (At(dimensions, 2) == "5xx") serverErrors += series.Count;
                }

                return new InsightsRouteStat(
                    group.Key.Route,
                    group.Key.Method,
                    all.Count,
                    clientErrors,
                    serverErrors,
                    Round(all.Percentile(0.5)),
                    Round(all.Percentile(0.95)),
                    all.Count == 0 ? null : Round(all.Max));
            })
            .Where(r => r.Count > 0)
            .OrderByDescending(r => r.Count)
            .ThenBy(r => r.Route, StringComparer.Ordinal)
            .ThenBy(r => r.Method, StringComparer.Ordinal)
            .Take(RouteLimit)
            .ToList();

        var clients = frame.Of(InsightMetrics.HttpRequests)
            .GroupBy(s => At(s.Dimensions, 3))
            .Select(group =>
            {
                var kind = frame.Total(InsightMetrics.HttpRequests, d => At(d, 3) == group.Key);
                return new InsightsClientStat(group.Key, kind.Count, Round(kind.Percentile(0.95)));
            })
            .Where(c => c.Count > 0)
            .OrderByDescending(c => c.Count)
            .ToList();

        var policies = frame.Of(InsightMetrics.HttpRateLimited)
            .Select(s => At(s.Dimensions, 0))
            .Distinct()
            .Order(StringComparer.Ordinal)
            .Select(policy => Series(policy, frame.Values(InsightMetrics.HttpRateLimited, Sum, d => At(d, 0) == policy)))
            .ToList();

        return new InsightsRequestsResponse(
            Frame(frame, collector.StartedAt),
            total.Count,
            Round(total.Percentile(0.5)),
            Round(total.Percentile(0.95)),
            [
                .. StatusClasses.Select(status =>
                    Series(status, frame.Values(InsightMetrics.HttpRequests, Count, d => At(d, 2) == status)))
            ],
            [
                Series("p50", frame.Values(InsightMetrics.HttpRequests, P50, empty: null)),
                Series("p95", frame.Values(InsightMetrics.HttpRequests, P95, empty: null))
            ],
            policies,
            routes,
            clients);
    }
}
