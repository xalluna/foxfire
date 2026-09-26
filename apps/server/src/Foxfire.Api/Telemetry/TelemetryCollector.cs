using System.Diagnostics.Metrics;
using System.Globalization;
using Foxfire.Api.Configuration;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Riot;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Telemetry;

/// <summary>
/// Gathers what the server is doing into the insights history.
///
/// Three sources. Instruments on meters — ASP.NET Core's own request timings
/// and rate limiter, the runtime's exception count, and Foxfire's Riot, sync
/// and database instruments — are listened to as they fire. Levels that are
/// only worth reading now and then — the Riot queue, syncs running, who is
/// connected, CPU and memory, lines logged — are sampled every ten seconds.
/// Both land in <see cref="TelemetryBuffer"/>'s open bucket, which is closed on
/// the same ten-second tick.
///
/// Then the history. Each minute is written to the database once all of its
/// buckets are closed, marked with this process so that a minute two processes
/// shared adds up rather than overwrites. Every hour, once its last minute has
/// had time to land, its minutes are folded into hour rows and anything past
/// its keeping is dropped. On the way down, the minute still filling is written
/// too, so a deploy loses nothing but the seconds it took.
///
/// Only instruments from this host's own <see cref="IMeterFactory"/> are
/// listened to, which is what keeps the test suite's dozens of hosts — one
/// process, one database — each counting only themselves. The runtime's meter
/// is the exception, being the process's: every host counts every exception.
/// </summary>
public sealed class TelemetryCollector : BackgroundService
{
    /// <summary>How long after an hour ends before it is folded: long enough for its last minute to be written.</summary>
    public static readonly TimeSpan FoldDelay = TimeSpan.FromMinutes(2);

    private static readonly TimeSpan Minute = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Hour = TimeSpan.FromHours(1);

    private readonly IMeterFactory _meters;
    private readonly TelemetryBuffer _buffer;
    private readonly TimeProvider _time;
    private readonly IServiceScopeFactory _scopes;
    private readonly IOptions<TelemetryOptions> _options;
    private readonly RiotRateLimiter _limiter;
    private readonly SyncService _syncs;
    private readonly PostGameSyncScheduler _postGame;
    private readonly ConnectedClients _clients;
    private readonly RecentLogs _logs;
    private readonly ILogger<TelemetryCollector> _log;
    private readonly MeterListener _listener = new();
    private readonly Lock _gate = new();

    private DateTimeOffset _flushedThrough;
    private DateTimeOffset? _maintainedThrough;
    private bool _flushFailing;
    private TimeSpan _lastCpu;
    private long _lastCpuAt;
    private TimeSpan _lastPause;
    private IReadOnlyDictionary<string, long> _lastLogCounts = new Dictionary<string, long>();

    public TelemetryCollector(
        IMeterFactory meters,
        TelemetryBuffer buffer,
        TimeProvider time,
        IServiceScopeFactory scopes,
        IOptions<TelemetryOptions> options,
        RiotRateLimiter limiter,
        SyncService syncs,
        PostGameSyncScheduler postGame,
        ConnectedClients clients,
        RecentLogs logs,
        ILogger<TelemetryCollector> log)
    {
        _meters = meters;
        _buffer = buffer;
        _time = time;
        _scopes = scopes;
        _options = options;
        _limiter = limiter;
        _syncs = syncs;
        _postGame = postGame;
        _clients = clients;
        _logs = logs;
        _log = log;

        StartedAt = time.GetUtcNow();
    }

    /// <summary>This process, as its minute rows name it.</summary>
    public Guid Instance { get; } = Guid.CreateVersion7();

    public DateTimeOffset StartedAt { get; }

    /// <summary>Whether finished minutes are being written down. See <see cref="TelemetryOptions.Persist"/>.</summary>
    public bool Persisting => _options.Value.Persist;

    /// <summary>
    /// Every minute before this one is in the database, as far as this process
    /// is concerned. A read takes minutes before it from there and minutes from
    /// it onwards from memory, so nothing is counted twice or missed.
    /// </summary>
    public DateTimeOffset FlushedThrough
    {
        get { lock (_gate) return _flushedThrough; }
    }

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();

        _buffer.Begin(InsightWindow.Floor(now, InsightWindows.LiveStep));
        lock (_gate) _flushedThrough = InsightWindow.Floor(now, Minute);

        _lastCpu = Environment.CpuUsage.TotalTime;
        _lastCpuAt = _time.GetTimestamp();
        _lastPause = GC.GetTotalPauseDuration();
        _lastLogCounts = _logs.Counts();

        Listen();

        return base.StartAsync(cancellationToken);
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);

        try
        {
            // The seconds since the last tick, and the minute they belong to —
            // written now, because nobody else will.
            var now = _time.GetUtcNow();
            Sample();
            _buffer.Close(InsightWindow.Floor(now, InsightWindows.LiveStep) + InsightWindows.LiveStep);

            if (Persisting) await FlushAsync(InsightWindow.Floor(now, Minute) + Minute, cancellationToken);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            _log.LogWarning(ex, "Could not write the last minute of insights on the way down");
        }
        finally
        {
            _listener.Dispose();
        }
    }

    public override void Dispose()
    {
        _listener.Dispose();
        base.Dispose();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // To the next ten-second boundary first, so every bucket starts on
            // one and a chart's points line up with the clock.
            var now = _time.GetUtcNow();
            var first = InsightWindow.Floor(now, InsightWindows.LiveStep) + InsightWindows.LiveStep;
            await Task.Delay(first - now, _time, stoppingToken);

            using var timer = new PeriodicTimer(InsightWindows.LiveStep, _time);

            do
            {
                try
                {
                    await TickAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // A background service that throws takes the whole host down
                    // with it, and a chart is not worth a server. The next tick
                    // tries again.
                    _log.LogWarning(ex, "Could not take the insights measurements for this tick");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down; StopAsync writes what is left.
        }
    }

    /// <summary>One ten-second step: sample, close the bucket, and write down whatever has finished.</summary>
    public async Task TickAsync(CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();

        Sample();
        _buffer.Close(InsightWindow.Floor(now, InsightWindows.LiveStep));

        if (!Persisting) return;

        await FlushAsync(InsightWindow.Floor(now, Minute), cancellationToken);
        await MaintainAsync(now, cancellationToken);
    }

    /// <summary>Writes every minute before <paramref name="until"/> that this process has not written yet.</summary>
    private async Task FlushAsync(DateTimeOffset until, CancellationToken cancellationToken)
    {
        var from = FlushedThrough;
        if (from >= until) return;

        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            for (var minute = from; minute < until; minute += Minute)
            {
                var end = minute + Minute;
                Dictionary<SeriesKey, InsightAggregate> series = [];

                foreach (var bucket in _buffer.Closed(minute).TakeWhile(b => b.Start < end))
                {
                    foreach (var (key, aggregate) in bucket.Series)
                    {
                        if (series.TryGetValue(key, out var merged)) merged.Merge(aggregate);
                        else series[key] = aggregate.Clone();
                    }
                }

                if (series.Count > 0)
                {
                    await TelemetryStore.FlushAsync(db, Instance, minute, series, cancellationToken);
                }

                lock (_gate) _flushedThrough = end;
            }

            if (_flushFailing)
            {
                _flushFailing = false;
                _log.LogInformation("Writing insights history again");
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The minutes stay in memory for an hour and are retried every tick,
            // so a database restart costs nothing. Said once rather than every
            // ten seconds.
            if (!_flushFailing)
            {
                _flushFailing = true;
                _log.LogWarning(ex, "Could not write insights history; retrying every ten seconds");
            }
        }
    }

    /// <summary>
    /// Once an hour: folds the hours that have finished and drops what is past
    /// keeping. The first time, it looks back over every minute still kept, to
    /// fold whatever a previous process stopped before folding.
    /// </summary>
    private async Task MaintainAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var complete = InsightWindow.Floor(now - FoldDelay, Hour);
        if (_maintainedThrough == complete) return;

        var lookBack = _maintainedThrough is null ? InsightWindows.MinuteSpan : TimeSpan.FromHours(3);

        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            var folded = 0;
            foreach (var hour in await TelemetryStore.UnfoldedHoursAsync(db, complete - lookBack, complete, cancellationToken))
            {
                if (await TelemetryStore.FoldHourAsync(db, hour, cancellationToken)) folded++;
            }

            var retention = _options.Value.RetentionDays;
            var removed = await TelemetryStore.PruneAsync(
                db,
                now - InsightWindows.MinuteSpan,
                retention > 0 ? now - TimeSpan.FromDays(retention) : null,
                cancellationToken);

            _log.LogDebug("Folded {Hours} hours of insights and dropped {Rows} rows past keeping", folded, removed);
            _maintainedThrough = complete;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Tried again next tick. Nothing is lost by waiting: minutes are kept
            // for two days, and folding is the same whenever it happens.
            _log.LogWarning(ex, "Could not fold or trim insights history");
        }
    }

    /// <summary>The levels, read now and put into the open bucket.</summary>
    private void Sample()
    {
        var riot = _limiter.Snapshot();
        foreach (var priority in Enum.GetValues<RiotRequestPriority>())
        {
            _buffer.Record(
                InsightMetrics.RiotQueueDepth,
                InsightMetrics.Dimensions(RiotMetrics.PriorityName(priority)),
                riot.Depths[(int)priority]);
        }

        _buffer.Record(InsightMetrics.RiotWindowUsage, "burst", riot.BurstUsed);
        _buffer.Record(InsightMetrics.RiotWindowUsage, "sustained", riot.SustainedUsed);

        _buffer.Record(InsightMetrics.SyncInFlight, "", _syncs.InFlightCount);
        _buffer.Record(InsightMetrics.SyncPostGamePending, "", _postGame.PendingCount);

        foreach (var group in _clients.Snapshot())
        {
            _buffer.Record(InsightMetrics.ClientsConnected, InsightMetrics.Dimensions(group.Kind, group.Version), group.Count);
        }

        var cpu = Environment.CpuUsage.TotalTime;
        var at = _time.GetTimestamp();
        var elapsed = _time.GetElapsedTime(_lastCpuAt, at);
        if (elapsed > TimeSpan.Zero)
        {
            var share = (cpu - _lastCpu).TotalSeconds / (elapsed.TotalSeconds * Environment.ProcessorCount);
            _buffer.Record(InsightMetrics.RuntimeCpu, "", Math.Clamp(share * 100, 0, 100));
        }

        _lastCpu = cpu;
        _lastCpuAt = at;

        _buffer.Record(InsightMetrics.RuntimeWorkingSet, "", Environment.WorkingSet);
        _buffer.Record(InsightMetrics.RuntimeGcHeap, "", GC.GetGCMemoryInfo().HeapSizeBytes);
        _buffer.Record(InsightMetrics.RuntimeThreadPoolQueue, "", ThreadPool.PendingWorkItemCount);

        var pause = GC.GetTotalPauseDuration();
        if (pause > _lastPause) _buffer.Record(InsightMetrics.RuntimeGcPause, "", (pause - _lastPause).TotalMilliseconds);
        _lastPause = pause;

        var counts = _logs.Counts();
        foreach (var (level, count) in counts)
        {
            var added = count - _lastLogCounts.GetValueOrDefault(level);
            if (added > 0) _buffer.Record(InsightMetrics.LogEvents, level, added);
        }

        _lastLogCounts = counts;
    }

    private delegate string? DimensionReader(ReadOnlySpan<KeyValuePair<string, object?>> tags);

    /// <summary>Which stored metric an instrument feeds, how to scale it to milliseconds, and which of its tags to keep.</summary>
    private sealed record Mapping(string Metric, double Scale, DimensionReader Dimensions);

    private void Listen()
    {
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            var ours = ReferenceEquals(instrument.Meter.Scope, _meters) || instrument.Meter.Name == "System.Runtime";
            if (ours && MappingFor(instrument) is { } mapping) listener.EnableMeasurementEvents(instrument, mapping);
        };

        _listener.SetMeasurementEventCallback<double>((_, value, tags, state) => Measured(state, value, tags));
        _listener.SetMeasurementEventCallback<long>((_, value, tags, state) => Measured(state, value, tags));
        _listener.SetMeasurementEventCallback<int>((_, value, tags, state) => Measured(state, value, tags));

        _listener.Start();
    }

    private void Measured(object? state, double value, ReadOnlySpan<KeyValuePair<string, object?>> tags)
    {
        if (state is not Mapping mapping) return;

        try
        {
            if (mapping.Dimensions(tags) is { } dimensions) _buffer.Record(mapping.Metric, dimensions, value * mapping.Scale);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // On a request's own thread, so never thrown back into it. A
            // measurement lost is a point on a chart; a request lost is not.
            _log.LogDebug(ex, "Could not record a {Metric} measurement", mapping.Metric);
        }
    }

    private static Mapping? MappingFor(Instrument instrument) => (instrument.Meter.Name, instrument.Name) switch
    {
        ("Microsoft.AspNetCore.Hosting", "http.server.request.duration") =>
            new Mapping(InsightMetrics.HttpRequests, 1_000, tags => InsightMetrics.Dimensions(
                Tag(tags, "http.route") ?? "(static)",
                Tag(tags, "http.request.method"),
                StatusClass(Tag(tags, "http.response.status_code")),
                Tag(tags, RequestMetricTags.Client) ?? "unnamed")),

        // Only the refusals: an admitted request is already one of the requests.
        ("Microsoft.AspNetCore.RateLimiting", "aspnetcore.rate_limiting.requests") =>
            new Mapping(InsightMetrics.HttpRateLimited, 1, tags =>
                Tag(tags, "aspnetcore.rate_limiting.result") is "endpoint_limiter" or "global_limiter"
                    ? InsightMetrics.Dimensions(Tag(tags, "aspnetcore.rate_limiting.policy") ?? "global")
                    : null),

        ("System.Runtime", "dotnet.exceptions") =>
            new Mapping(InsightMetrics.RuntimeExceptions, 1, tags => InsightMetrics.Dimensions(ShortType(Tag(tags, "error.type")))),

        (RiotMetrics.MeterName, RiotMetrics.RequestDuration) =>
            new Mapping(InsightMetrics.RiotRequests, 1, tags => InsightMetrics.Dimensions(
                Tag(tags, "endpoint"), Tag(tags, "outcome"), Tag(tags, "priority"))),

        (RiotMetrics.MeterName, RiotMetrics.QueueWait) =>
            new Mapping(InsightMetrics.RiotQueueWait, 1, tags => InsightMetrics.Dimensions(Tag(tags, "priority"))),

        (ServerMetrics.MeterName, ServerMetrics.SyncDuration) =>
            new Mapping(InsightMetrics.SyncRuns, 1, tags => InsightMetrics.Dimensions(
                Tag(tags, "trigger"), Tag(tags, "kind"), Tag(tags, "outcome"))),

        (ServerMetrics.MeterName, ServerMetrics.SyncMatches) =>
            new Mapping(InsightMetrics.SyncMatches, 1, tags => InsightMetrics.Dimensions(Tag(tags, "result"))),

        (ServerMetrics.MeterName, ServerMetrics.DbCommandDuration) =>
            new Mapping(InsightMetrics.DbCommands, 1, tags => InsightMetrics.Dimensions(Tag(tags, "kind"))),

        _ => null
    };

    private static string? Tag(ReadOnlySpan<KeyValuePair<string, object?>> tags, string name)
    {
        foreach (var tag in tags)
        {
            if (tag.Key != name) continue;

            return tag.Value switch
            {
                null => null,
                string text => text,
                IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
                var other => other.ToString()
            };
        }

        return null;
    }

    private static string StatusClass(string? status) =>
        int.TryParse(status, NumberStyles.None, CultureInfo.InvariantCulture, out var code) && code is >= 100 and < 600
            ? $"{code / 100}xx"
            : "none";

    private static string ShortType(string? type)
    {
        if (string.IsNullOrEmpty(type)) return "unknown";
        var dot = type.LastIndexOf('.');
        return dot >= 0 ? type[(dot + 1)..] : type;
    }
}
