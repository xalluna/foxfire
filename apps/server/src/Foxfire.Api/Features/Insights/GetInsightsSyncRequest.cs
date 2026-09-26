using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using static Foxfire.Api.Features.Insights.InsightsShapes;

namespace Foxfire.Api.Features.Insights;

/// <summary>One sync run the server did recently.</summary>
/// <param name="Trigger">manual or auto.</param>
/// <param name="Kind">backfill, delta, or unknown for a run that failed before it could tell.</param>
/// <param name="Outcome">ok, partial when some matches failed, or failed.</param>
public sealed record InsightsSyncRun(
    Guid AccountId,
    string? RiotId,
    string Trigger,
    string Kind,
    long StartedAt,
    long DurationMs,
    int Stored,
    int Failed,
    string Outcome,
    string? Error);

/// <param name="Failed">Runs that threw.</param>
/// <param name="Partial">Runs that stored some matches and missed others.</param>
/// <param name="MatchesFailed">Matches runs could not fetch, retried by the next.</param>
public sealed record InsightsSyncTotals(
    long Runs,
    long Manual,
    long Auto,
    long Failed,
    long Partial,
    long Stored,
    long MatchesFailed,
    double? P50Ms,
    double? P95Ms);

/// <param name="Running">Syncs under way.</param>
/// <param name="PostGamePending">Accounts whose just-finished game is being waited for.</param>
public sealed record InsightsSyncNow(int Running, int PostGamePending);

/// <param name="Runs">Runs finished per point, by outcome: ok, partial, failed.</param>
/// <param name="Duration">p50 and p95 per point, in milliseconds.</param>
/// <param name="Matches">Matches stored and failed per point.</param>
/// <param name="Load">The most syncs running, and post-game ladders waiting, in each point.</param>
/// <param name="Recent">The last ten runs, newest first. Since this process started.</param>
public sealed record InsightsSyncResponse(
    InsightsFrameResponse Frame,
    InsightsSyncTotals Totals,
    InsightsSyncNow Now,
    IReadOnlyList<InsightSeriesResponse> Runs,
    IReadOnlyList<InsightSeriesResponse> Duration,
    IReadOnlyList<InsightSeriesResponse> Matches,
    IReadOnlyList<InsightSeriesResponse> Load,
    IReadOnlyList<InsightsSyncRun> Recent);

/// <summary>How the server has been keeping everybody's history up to date.</summary>
public sealed record GetInsightsSyncRequest(string? Window) : IDomainRequest<InsightsSyncResponse>;

internal sealed class GetInsightsSyncRequestHandler(
    InsightsReader reader,
    TelemetryCollector collector,
    SyncService syncs,
    PostGameSyncScheduler postGame,
    RecentSyncs recent)
    : IDomainRequestHandler<GetInsightsSyncRequest, InsightsSyncResponse>
{
    private static readonly string[] Metrics =
    [
        InsightMetrics.SyncRuns,
        InsightMetrics.SyncMatches,
        InsightMetrics.SyncInFlight,
        InsightMetrics.SyncPostGamePending
    ];

    private static readonly string[] Outcomes = ["ok", "partial", "failed"];

    public async Task<Response<InsightsSyncResponse>> Handle(
        GetInsightsSyncRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (InsightWindows.Parse(request.Window) is not { } window)
        {
            return InvalidWindow<InsightsSyncResponse>(request.Window);
        }

        var frame = await reader.ReadAsync(window, Metrics, cancellationToken);
        var runs = frame.Total(InsightMetrics.SyncRuns);

        var totals = new InsightsSyncTotals(
            Runs: runs.Count,
            Manual: frame.Total(InsightMetrics.SyncRuns, d => At(d, 0) == "manual").Count,
            Auto: frame.Total(InsightMetrics.SyncRuns, d => At(d, 0) == "auto").Count,
            Failed: frame.Total(InsightMetrics.SyncRuns, d => At(d, 2) == "failed").Count,
            Partial: frame.Total(InsightMetrics.SyncRuns, d => At(d, 2) == "partial").Count,
            Stored: (long)frame.Total(InsightMetrics.SyncMatches, d => At(d, 0) == "stored").Sum,
            MatchesFailed: (long)frame.Total(InsightMetrics.SyncMatches, d => At(d, 0) == "failed").Sum,
            P50Ms: Round(runs.Percentile(0.5)),
            P95Ms: Round(runs.Percentile(0.95)));

        return new InsightsSyncResponse(
            Frame(frame, collector.StartedAt),
            totals,
            new InsightsSyncNow(syncs.InFlightCount, postGame.PendingCount),
            [
                .. Outcomes.Select(o =>
                    Series(o, frame.Values(InsightMetrics.SyncRuns, Count, d => At(d, 2) == o)))
            ],
            [
                Series("p50", frame.Values(InsightMetrics.SyncRuns, P50, empty: null)),
                Series("p95", frame.Values(InsightMetrics.SyncRuns, P95, empty: null))
            ],
            [
                Series("stored", frame.Values(InsightMetrics.SyncMatches, Sum, d => At(d, 0) == "stored")),
                Series("failed", frame.Values(InsightMetrics.SyncMatches, Sum, d => At(d, 0) == "failed"))
            ],
            [
                Series("running", frame.Values(InsightMetrics.SyncInFlight, Max, empty: null)),
                Series("postGame", frame.Values(InsightMetrics.SyncPostGamePending, Max, empty: null))
            ],
            [
                .. recent.Latest().Select(r => new InsightsSyncRun(
                    r.AccountId,
                    r.RiotId,
                    r.Trigger,
                    r.Kind,
                    r.StartedAt.ToUnixTimeMilliseconds(),
                    (long)r.Duration.TotalMilliseconds,
                    r.Stored,
                    r.Failed,
                    r.Outcome,
                    r.Error))
            ]);
    }
}
