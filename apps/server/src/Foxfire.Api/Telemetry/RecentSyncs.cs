namespace Foxfire.Api.Telemetry;

/// <summary>One finished sync run.</summary>
/// <param name="Trigger">manual or auto.</param>
/// <param name="Kind">backfill, delta, or unknown for a run that failed before it could tell.</param>
/// <param name="Outcome">ok, partial when some matches failed, or failed.</param>
/// <param name="Error">For a run that failed, what the member was told.</param>
public sealed record SyncRunRecord(
    Guid AccountId,
    string? RiotId,
    string Trigger,
    string Kind,
    DateTimeOffset StartedAt,
    TimeSpan Duration,
    int Stored,
    int Failed,
    string Outcome,
    string? Error);

/// <summary>
/// The last few syncs this process ran, for the insights page.
///
/// A handful by construction rather than a list that grows: the chart above it
/// covers the trend, and this is only there to say what the server just did.
/// </summary>
public sealed class RecentSyncs
{
    public const int Capacity = 10;

    private readonly Lock _gate = new();
    private readonly LinkedList<SyncRunRecord> _runs = new();

    public void Add(SyncRunRecord run)
    {
        lock (_gate)
        {
            _runs.AddFirst(run);
            while (_runs.Count > Capacity) _runs.RemoveLast();
        }
    }

    /// <summary>Newest first.</summary>
    public IReadOnlyList<SyncRunRecord> Latest()
    {
        lock (_gate) return [.. _runs];
    }
}
