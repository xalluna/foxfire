using System.Diagnostics.Metrics;

namespace Foxfire.Api.Telemetry;

/// <summary>
/// What the server's own work costs, on a meter — syncs, database commands and mail.
///
/// Instruments rather than calls into the collector, for the reason the Riot
/// client's are: the collector is one listener, and an OpenTelemetry exporter
/// would be another without anything here changing. From the host's
/// <see cref="IMeterFactory"/>, never a static meter, so each of the test
/// suite's hosts listens only to itself.
/// </summary>
public sealed class ServerMetrics
{
    public const string MeterName = "Foxfire.Server";

    /// <summary>One sync run, start to finish.</summary>
    public const string SyncDuration = "foxfire.sync.duration";

    /// <summary>Matches a run stored, or could not fetch.</summary>
    public const string SyncMatches = "foxfire.sync.matches";

    /// <summary>One database command.</summary>
    public const string DbCommandDuration = "foxfire.db.command.duration";

    /// <summary>One attempt to hand an email to the provider, and what came of it.</summary>
    public const string EmailSends = "foxfire.email.sends";

    /// <summary>One thing the provider said afterwards — delivered, bounced.</summary>
    public const string EmailEvents = "foxfire.email.events";

    private readonly Histogram<double> _syncs;
    private readonly Counter<long> _matches;
    private readonly Histogram<double> _commands;
    private readonly Counter<long> _emailSends;
    private readonly Counter<long> _emailEvents;

    public ServerMetrics(IMeterFactory meters)
    {
        ArgumentNullException.ThrowIfNull(meters);

        var meter = meters.Create(MeterName);
        _syncs = meter.CreateHistogram<double>(SyncDuration, "ms", "How long a sync run took");
        _matches = meter.CreateCounter<long>(SyncMatches, "{match}", "Matches a sync stored or failed to fetch");
        _commands = meter.CreateHistogram<double>(DbCommandDuration, "ms", "How long a database command took");
        _emailSends = meter.CreateCounter<long>(EmailSends, "{email}", "Emails handed to the provider, by outcome");
        _emailEvents = meter.CreateCounter<long>(EmailEvents, "{event}", "What the provider said about emails afterwards");
    }

    /// <param name="kind">backfill, delta, or unknown for a run that failed before it could tell.</param>
    /// <param name="outcome">ok, partial when some matches failed, failed when the run threw.</param>
    public void SyncFinished(string trigger, string kind, string outcome, TimeSpan elapsed, int stored, int failed)
    {
        _syncs.Record(
            elapsed.TotalMilliseconds,
            new KeyValuePair<string, object?>("trigger", trigger),
            new KeyValuePair<string, object?>("kind", kind),
            new KeyValuePair<string, object?>("outcome", outcome));

        if (stored > 0) _matches.Add(stored, new KeyValuePair<string, object?>("result", "stored"));
        if (failed > 0) _matches.Add(failed, new KeyValuePair<string, object?>("result", "failed"));
    }

    /// <param name="kind">reader, nonquery, scalar, or failed.</param>
    public void DbCommand(string kind, TimeSpan elapsed) =>
        _commands.Record(elapsed.TotalMilliseconds, new KeyValuePair<string, object?>("kind", kind));

    /// <param name="kind">What the email was for — one of EmailKinds.</param>
    /// <param name="outcome">sent, held, retry, failed, refused or dropped.</param>
    public void EmailSent(string kind, string outcome) =>
        _emailSends.Add(
            1,
            new KeyValuePair<string, object?>("kind", kind),
            new KeyValuePair<string, object?>("outcome", outcome));

    /// <param name="event">delivered, delayed, bounced, complained, failed or suppressed.</param>
    public void EmailEvent(string kind, string @event) =>
        _emailEvents.Add(
            1,
            new KeyValuePair<string, object?>("kind", kind),
            new KeyValuePair<string, object?>("event", @event));
}
