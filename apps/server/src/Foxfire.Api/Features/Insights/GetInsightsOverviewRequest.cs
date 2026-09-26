using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using Foxfire.Riot;
using static Foxfire.Api.Features.Insights.InsightsShapes;

namespace Foxfire.Api.Features.Insights;

/// <summary>The window's headline figures.</summary>
/// <param name="ServerErrors">Requests answered 5xx.</param>
/// <param name="RiotThrottled">Riot calls answered 429.</param>
/// <param name="SyncFailed">Runs that threw; a run that stored some matches and missed others is not counted here.</param>
public sealed record InsightsOverviewTotals(
    long Requests,
    long ServerErrors,
    double? RequestP95Ms,
    long RiotCalls,
    long RiotThrottled,
    long SyncRuns,
    long SyncFailed,
    long Warnings,
    long Errors);

/// <summary>Right now, rather than over the window.</summary>
public sealed record InsightsOverviewNow(
    int Desktops,
    int WebClients,
    double? CpuPercent,
    long WorkingSetBytes,
    int SyncsRunning,
    int RiotQueued,
    bool RiotKeyRejected);

/// <param name="Series">
/// requests, serverErrors and p95 for the API; riot and throttled for Riot;
/// cpu and memory for the process; warnings and errors from the log.
/// </param>
public sealed record InsightsOverviewResponse(
    InsightsFrameResponse Frame,
    string ServerVersion,
    InsightsOverviewTotals Totals,
    InsightsOverviewNow Now,
    IReadOnlyList<InsightSeriesResponse> Series);

/// <summary>The insights page's first tab: is the server all right, and has it been.</summary>
public sealed record GetInsightsOverviewRequest(string? Window) : IDomainRequest<InsightsOverviewResponse>;

internal sealed class GetInsightsOverviewRequestHandler(
    InsightsReader reader,
    TelemetryCollector collector,
    ConnectedClients clients,
    SyncService syncs,
    RiotRateLimiter limiter)
    : IDomainRequestHandler<GetInsightsOverviewRequest, InsightsOverviewResponse>
{
    private static readonly string[] Metrics =
    [
        InsightMetrics.HttpRequests,
        InsightMetrics.RiotRequests,
        InsightMetrics.SyncRuns,
        InsightMetrics.RuntimeCpu,
        InsightMetrics.RuntimeWorkingSet,
        InsightMetrics.LogEvents
    ];

    public async Task<Response<InsightsOverviewResponse>> Handle(
        GetInsightsOverviewRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (InsightWindows.Parse(request.Window) is not { } window)
        {
            return InvalidWindow<InsightsOverviewResponse>(request.Window);
        }

        var frame = await reader.ReadAsync(window, Metrics, cancellationToken);

        static bool IsServerError(string[] d) => At(d, 2) == "5xx";
        static bool IsThrottled(string[] d) => At(d, 1) == "throttled";
        static bool IsWarning(string[] d) => At(d, 0) == "warning";
        static bool IsError(string[] d) => At(d, 0) is "error" or "fatal";

        var requests = frame.Total(InsightMetrics.HttpRequests);
        var runs = frame.Total(InsightMetrics.SyncRuns);

        var totals = new InsightsOverviewTotals(
            Requests: requests.Count,
            ServerErrors: frame.Total(InsightMetrics.HttpRequests, IsServerError).Count,
            RequestP95Ms: Round(requests.Percentile(0.95)),
            RiotCalls: frame.Total(InsightMetrics.RiotRequests).Count,
            RiotThrottled: frame.Total(InsightMetrics.RiotRequests, IsThrottled).Count,
            SyncRuns: runs.Count,
            SyncFailed: frame.Total(InsightMetrics.SyncRuns, d => At(d, 2) == "failed").Count,
            Warnings: (long)frame.Total(InsightMetrics.LogEvents, IsWarning).Sum,
            Errors: (long)frame.Total(InsightMetrics.LogEvents, IsError).Sum);

        var connected = clients.Snapshot();
        var cpu = frame.Values(InsightMetrics.RuntimeCpu, Mean, empty: null);

        var now = new InsightsOverviewNow(
            Desktops: connected.Where(c => c.Kind == "desktop").Sum(c => c.Count),
            WebClients: connected.Where(c => c.Kind == "web").Sum(c => c.Count),
            CpuPercent: cpu.LastOrDefault(v => v is not null),
            WorkingSetBytes: Environment.WorkingSet,
            SyncsRunning: syncs.InFlightCount,
            RiotQueued: limiter.QueueDepth,
            RiotKeyRejected: limiter.KeyRejected);

        return new InsightsOverviewResponse(
            Frame(frame, collector.StartedAt),
            ServerBuild.Version,
            totals,
            now,
            [
                Series("requests", frame.Values(InsightMetrics.HttpRequests, Count)),
                Series("serverErrors", frame.Values(InsightMetrics.HttpRequests, Count, IsServerError)),
                Series("p95", frame.Values(InsightMetrics.HttpRequests, P95, empty: null)),
                Series("riot", frame.Values(InsightMetrics.RiotRequests, Count)),
                Series("throttled", frame.Values(InsightMetrics.RiotRequests, Count, IsThrottled)),
                Series("cpu", cpu),
                Series("memory", frame.Values(InsightMetrics.RuntimeWorkingSet, Mean, empty: null)),
                Series("warnings", frame.Values(InsightMetrics.LogEvents, Sum, IsWarning)),
                Series("errors", frame.Values(InsightMetrics.LogEvents, Sum, IsError))
            ]);
    }
}
