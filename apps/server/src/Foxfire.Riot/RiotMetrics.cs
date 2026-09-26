using System.Diagnostics.Metrics;

namespace Foxfire.Riot;

/// <summary>
/// What every Riot call cost, on a meter anything in the process can listen to.
///
/// A meter rather than a callback into the server, because this assembly knows
/// nothing of the server and should not start: the insights page listens for
/// these by name, and so would an OpenTelemetry exporter if a host ever wanted
/// one. Built from the host's <see cref="IMeterFactory"/> rather than as a static,
/// so a test process that builds a dozen hosts has a dozen meters, each
/// listened to only by its own host.
///
/// Tagged by endpoint template, never by path: a path carries a puuid.
/// </summary>
public sealed class RiotMetrics
{
    public const string MeterName = "Foxfire.Riot";

    /// <summary>One attempt at one request, in milliseconds on the wire — not counting the queue.</summary>
    public const string RequestDuration = "foxfire.riot.request.duration";

    /// <summary>How long a request waited in the queue before its first attempt went out.</summary>
    public const string QueueWait = "foxfire.riot.queue.wait";

    private readonly Histogram<double> _requests;
    private readonly Histogram<double> _waits;

    public RiotMetrics(IMeterFactory meters)
    {
        ArgumentNullException.ThrowIfNull(meters);

        var meter = meters.Create(MeterName);
        _requests = meter.CreateHistogram<double>(RequestDuration, "ms", "Riot API request time on the wire");
        _waits = meter.CreateHistogram<double>(QueueWait, "ms", "Time a Riot request waited for the shared queue");
    }

    internal void Request(string endpoint, RiotRequestPriority priority, string outcome, TimeSpan elapsed) =>
        _requests.Record(
            elapsed.TotalMilliseconds,
            new KeyValuePair<string, object?>("endpoint", endpoint),
            new KeyValuePair<string, object?>("outcome", outcome),
            new KeyValuePair<string, object?>("priority", PriorityName(priority)));

    internal void Waited(RiotRequestPriority priority, TimeSpan elapsed) =>
        _waits.Record(
            elapsed.TotalMilliseconds,
            new KeyValuePair<string, object?>("priority", PriorityName(priority)));

    /// <summary>How a class of work is named on a chart.</summary>
    public static string PriorityName(RiotRequestPriority priority) => priority switch
    {
        RiotRequestPriority.Interactive => "interactive",
        RiotRequestPriority.PostGame => "post-game",
        _ => "backfill"
    };

    /// <summary>
    /// What an answer amounts to. Riot's own statuses, grouped by what a host
    /// would do about them: a 404 is an ordinary answer, a 429 is the budget,
    /// a 401 or 403 is the key, a 5xx is Riot's bad minute.
    /// </summary>
    public static string Outcome(int status) => status switch
    {
        >= 200 and < 300 => "ok",
        404 => "not_found",
        429 => "throttled",
        401 or 403 => "key_rejected",
        >= 500 => "server_error",
        _ => "client_error"
    };
}
