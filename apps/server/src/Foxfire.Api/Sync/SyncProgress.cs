using System.Text.Json.Serialization;

namespace Foxfire.Api.Sync;

/// <summary>Why a sync is running, so the desktop can keep a background one quiet.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SyncTrigger
{
    /// <summary>Somebody pressed the button and is watching.</summary>
    Manual,

    /// <summary>A game ended, or the server decided by itself. No spinner.</summary>
    Auto
}

/// <summary>Which part of a sync the numbers describe.</summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum SyncPhase
{
    /// <summary>The first pass over an account, reaching back to the backfill target.</summary>
    Backfill,

    /// <summary>Everything since the newest match already stored.</summary>
    Delta,

    Complete,
    Error
}

/// <summary>
/// One step of a sync, shaped exactly like the desktop's own progress event.
///
/// Deliberately identical, field for field, to the payload the renderer's
/// useSyncProgress hook already consumes — the IPC event becomes a SignalR
/// message, and nothing above the transport has to know which one delivered it.
/// </summary>
/// <param name="AccountId">
/// The Riot account, as a server id. The desktop's own event carries its local
/// integer; in server mode the renderer is looking at server ids anyway, so this
/// is the id it already holds.
/// </param>
public sealed record SyncProgressEvent(
    Guid AccountId,
    SyncPhase Phase,
    int Current,
    int Total,
    string? Message,
    SyncTrigger Trigger);

/// <summary>
/// Where sync progress goes.
///
/// An interface rather than a direct SignalR call so the engine can be tested
/// without a hub, and so a run triggered by something other than a person —
/// the post-game ladder, a startup sweep — does not need a connection to exist
/// before it can report anything.
/// </summary>
public interface ISyncProgressSink
{
    Task PublishAsync(SyncProgressEvent progress, CancellationToken cancellationToken = default);
}

/// <summary>Drops everything. The default until a hub is wired in front of it.</summary>
public sealed class NullSyncProgressSink : ISyncProgressSink
{
    public Task PublishAsync(SyncProgressEvent progress, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
