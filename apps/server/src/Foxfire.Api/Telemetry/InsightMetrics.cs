using Foxfire.Core;

namespace Foxfire.Api.Telemetry;

/// <summary>How a metric's four numbers are read.</summary>
public enum InsightKind
{
    /// <summary>A time in milliseconds per event: counted, summed, and spread for percentiles.</summary>
    Duration,

    /// <summary>Something added up: the sum is the figure, the count is how many additions.</summary>
    Counter,

    /// <summary>A level sampled every ten seconds: the mean and the peak are the figures.</summary>
    Gauge
}

/// <summary>One series of one metric.</summary>
public readonly record struct SeriesKey(string Metric, string Dimensions);

/// <summary>
/// Every metric the insights page keeps, by the name it is stored under.
///
/// The names are what the rollup table holds, so they are for good: renaming
/// one orphans its history. Each takes its dimensions in a fixed order, joined
/// with <c>|</c> by <see cref="Dimensions"/> — the order is noted beside each.
///
/// Adding one is a name here, its kind in <see cref="KindOf"/>, and a place
/// that records it: an instrument the collector listens to, or a gauge it
/// samples on every tick. See CLAUDE.md, "Server insights".
/// </summary>
public static class InsightMetrics
{
    /// <summary>Every request the server answered. route | method | status class | client.</summary>
    public const string HttpRequests = "http.requests";

    /// <summary>Requests turned away by the per-address limits. policy.</summary>
    public const string HttpRateLimited = "http.rate_limited";

    /// <summary>Every attempt at a Riot call, on the wire. endpoint | outcome | priority.</summary>
    public const string RiotRequests = "riot.requests";

    /// <summary>How long Riot calls waited for the shared queue. priority.</summary>
    public const string RiotQueueWait = "riot.queue_wait";

    /// <summary>Riot calls waiting. priority.</summary>
    public const string RiotQueueDepth = "riot.queue_depth";

    /// <summary>Requests inside each of the key's windows. burst | sustained.</summary>
    public const string RiotWindowUsage = "riot.window_usage";

    /// <summary>Every sync run, and how long it took. trigger | kind | outcome.</summary>
    public const string SyncRuns = "sync.runs";

    /// <summary>Matches a sync stored or could not fetch. stored | failed.</summary>
    public const string SyncMatches = "sync.matches";

    /// <summary>Syncs running.</summary>
    public const string SyncInFlight = "sync.in_flight";

    /// <summary>Accounts with a post-game retry ladder waiting.</summary>
    public const string SyncPostGamePending = "sync.post_game_pending";

    /// <summary>Every database command. reader | nonquery | scalar | failed.</summary>
    public const string DbCommands = "db.commands";

    /// <summary>Clients holding the hub open. kind | version.</summary>
    public const string ClientsConnected = "clients.connected";

    /// <summary>The process's share of the machine's CPU, in percent of all cores.</summary>
    public const string RuntimeCpu = "runtime.cpu";

    /// <summary>
    /// The process's working set, in bytes. Sampled on every tick whatever else
    /// happens, which makes it the heartbeat: a bucket without it is a bucket
    /// the server was not running for.
    /// </summary>
    public const string RuntimeWorkingSet = "runtime.working_set";

    /// <summary>The managed heap after the last collection, in bytes.</summary>
    public const string RuntimeGcHeap = "runtime.gc_heap";

    /// <summary>Time the runtime spent paused for garbage collection, in milliseconds.</summary>
    public const string RuntimeGcPause = "runtime.gc_pause";

    /// <summary>Work items waiting for a thread-pool thread.</summary>
    public const string RuntimeThreadPoolQueue = "runtime.threadpool_queue";

    /// <summary>Exceptions thrown, caught or not. type.</summary>
    public const string RuntimeExceptions = "runtime.exceptions";

    /// <summary>Log lines written. level.</summary>
    public const string LogEvents = "logs.events";

    /// <summary>The metric whose presence says the server was up. See <see cref="RuntimeWorkingSet"/>.</summary>
    public const string Heartbeat = RuntimeWorkingSet;

    /// <summary>
    /// How many series one metric may have before the rest share one.
    ///
    /// Dimensions come from routes, endpoints, exception types and desktop
    /// versions — all bounded in practice, none bounded by construction. A cap
    /// keeps one misbehaving source from filling the table; anything past it is
    /// counted under <see cref="Other"/> rather than dropped.
    /// </summary>
    public const int MaxSeriesPerMetric = 200;

    public const string Other = "other";

    /// <summary>Longest a dimensions string may be. See TelemetryRollupConfiguration.</summary>
    public const int MaxDimensionsLength = 256;

    public static InsightKind KindOf(string metric) => metric switch
    {
        HttpRequests or RiotRequests or RiotQueueWait or SyncRuns or DbCommands => InsightKind.Duration,
        HttpRateLimited or SyncMatches or RuntimeGcPause or RuntimeExceptions or LogEvents => InsightKind.Counter,
        _ => InsightKind.Gauge
    };

    /// <summary>An empty measurement of the right kind for a metric.</summary>
    public static InsightAggregate Empty(string metric) =>
        KindOf(metric) == InsightKind.Duration ? InsightAggregate.Duration() : InsightAggregate.Plain();

    /// <summary>
    /// Dimension values as stored: in order, joined with <c>|</c>, with any
    /// <c>|</c> inside a value replaced so the parts can be split apart again.
    /// </summary>
    public static string Dimensions(params string?[] values)
    {
        var joined = string.Join('|', values.Select(v => (v ?? "").Replace('|', '/')));
        return joined.Length <= MaxDimensionsLength ? joined : joined[..MaxDimensionsLength];
    }

    /// <summary>The stored dimensions, split back into their values.</summary>
    public static string[] Split(string dimensions) =>
        string.IsNullOrEmpty(dimensions) ? [] : dimensions.Split('|');
}
