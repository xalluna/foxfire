using Foxfire.Api.Common;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using static Foxfire.Api.Features.Insights.InsightsShapes;

namespace Foxfire.Api.Features.Insights;

/// <summary>Clients of one kind and version connected now.</summary>
/// <param name="Supported">
/// For a desktop, whether this server still serves its version. False is a
/// desktop that connected before the allow list moved on and has not been
/// restarted since — it will be refused on its next request.
/// </param>
public sealed record InsightsClientGroup(string Kind, string Version, int Count, bool Supported);

/// <summary>An exception type, and how often it was thrown in the window.</summary>
public sealed record InsightsExceptionStat(string Type, long Count);

/// <summary>The process, now.</summary>
public sealed record InsightsRuntimeNow(
    double? CpuPercent,
    long WorkingSetBytes,
    long GcHeapBytes,
    long ThreadPoolQueue,
    int ThreadCount,
    long UptimeSeconds);

/// <param name="Cpu">Mean and peak CPU per point, in percent of every core.</param>
/// <param name="Memory">Working set and managed heap per point, in bytes.</param>
/// <param name="GcPause">Milliseconds paused for garbage collection per point.</param>
/// <param name="ThreadPool">The longest the thread pool's queue got in each point.</param>
/// <param name="Exceptions">Exceptions thrown per point, caught or not.</param>
/// <param name="Database">Commands per point, and their p50 and p95 in milliseconds.</param>
/// <param name="Clients">Desktops and browser tabs connected, per point.</param>
public sealed record InsightsRuntimeResponse(
    InsightsFrameResponse Frame,
    InsightsRuntimeNow Now,
    long DbCommands,
    double? DbP95Ms,
    IReadOnlyList<InsightSeriesResponse> Cpu,
    IReadOnlyList<InsightSeriesResponse> Memory,
    IReadOnlyList<InsightSeriesResponse> GcPause,
    IReadOnlyList<InsightSeriesResponse> ThreadPool,
    IReadOnlyList<InsightSeriesResponse> Exceptions,
    IReadOnlyList<InsightSeriesResponse> Database,
    IReadOnlyList<InsightSeriesResponse> Clients,
    IReadOnlyList<InsightsClientGroup> Connected,
    IReadOnlyList<InsightsExceptionStat> TopExceptions);

/// <summary>The process itself: what it is using, and who is connected to it.</summary>
public sealed record GetInsightsRuntimeRequest(string? Window) : IDomainRequest<InsightsRuntimeResponse>;

internal sealed class GetInsightsRuntimeRequestHandler(
    InsightsReader reader,
    TelemetryCollector collector,
    ConnectedClients clients,
    TimeProvider time)
    : IDomainRequestHandler<GetInsightsRuntimeRequest, InsightsRuntimeResponse>
{
    private const int ExceptionLimit = 10;

    private static readonly string[] Metrics =
    [
        InsightMetrics.RuntimeCpu,
        InsightMetrics.RuntimeWorkingSet,
        InsightMetrics.RuntimeGcHeap,
        InsightMetrics.RuntimeGcPause,
        InsightMetrics.RuntimeThreadPoolQueue,
        InsightMetrics.RuntimeExceptions,
        InsightMetrics.DbCommands,
        InsightMetrics.ClientsConnected
    ];

    public async Task<Response<InsightsRuntimeResponse>> Handle(
        GetInsightsRuntimeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (InsightWindows.Parse(request.Window) is not { } window)
        {
            return InvalidWindow<InsightsRuntimeResponse>(request.Window);
        }

        var frame = await reader.ReadAsync(window, Metrics, cancellationToken);
        var cpu = frame.Values(InsightMetrics.RuntimeCpu, Mean, empty: null);
        var db = frame.Total(InsightMetrics.DbCommands);

        var now = new InsightsRuntimeNow(
            cpu.LastOrDefault(v => v is not null),
            Environment.WorkingSet,
            GC.GetGCMemoryInfo().HeapSizeBytes,
            ThreadPool.PendingWorkItemCount,
            ThreadPool.ThreadCount,
            (long)(time.GetUtcNow() - collector.StartedAt).TotalSeconds);

        var connected = clients.Snapshot()
            .Select(c => new InsightsClientGroup(
                c.Kind,
                c.Version,
                c.Count,
                c.Kind != "desktop" || DesktopCompatibility.Allowed.Contains(c.Version)))
            .ToList();

        var exceptions = frame.Of(InsightMetrics.RuntimeExceptions)
            .Select(s => At(s.Dimensions, 0))
            .Distinct()
            .Select(type => new InsightsExceptionStat(
                type,
                (long)frame.Total(InsightMetrics.RuntimeExceptions, d => At(d, 0) == type).Sum))
            .Where(e => e.Count > 0)
            .OrderByDescending(e => e.Count)
            .ThenBy(e => e.Type, StringComparer.Ordinal)
            .Take(ExceptionLimit)
            .ToList();

        return new InsightsRuntimeResponse(
            Frame(frame, collector.StartedAt),
            now,
            db.Count,
            Round(db.Percentile(0.95)),
            [
                Series("mean", cpu),
                Series("peak", frame.Values(InsightMetrics.RuntimeCpu, Max, empty: null))
            ],
            [
                Series("workingSet", frame.Values(InsightMetrics.RuntimeWorkingSet, Mean, empty: null)),
                Series("gcHeap", frame.Values(InsightMetrics.RuntimeGcHeap, Mean, empty: null))
            ],
            [Series("pause", frame.Values(InsightMetrics.RuntimeGcPause, Sum))],
            [Series("queue", frame.Values(InsightMetrics.RuntimeThreadPoolQueue, Max, empty: null))],
            [Series("thrown", frame.Values(InsightMetrics.RuntimeExceptions, Sum))],
            [
                Series("commands", frame.Values(InsightMetrics.DbCommands, Count)),
                Series("p50", frame.Values(InsightMetrics.DbCommands, P50, empty: null)),
                Series("p95", frame.Values(InsightMetrics.DbCommands, P95, empty: null))
            ],
            [
                Series("desktop", frame.GaugeTotal(InsightMetrics.ClientsConnected, d => At(d, 0) == "desktop")),
                Series("web", frame.GaugeTotal(InsightMetrics.ClientsConnected, d => At(d, 0) == "web"))
            ],
            connected,
            exceptions);
    }
}
