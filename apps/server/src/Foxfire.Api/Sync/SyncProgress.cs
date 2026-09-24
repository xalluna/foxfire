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
/// Everything this server tells the desktops connected to it.
///
/// An interface rather than direct SignalR calls so the engine can be tested
/// without a hub, and so something triggered by nobody — the post-game ladder,
/// a startup sweep, a key that expired overnight — does not need a connection
/// to exist before it can report anything.
///
/// Every method here has a counterpart the desktop already raised for itself in
/// local-only mode, on the same channel with the same payload. That is the whole
/// design: what changes is which process noticed, not what the renderer is told.
/// </summary>
public interface IServerEvents
{
    /// <summary>How far through a sync an account is.</summary>
    Task SyncProgressAsync(SyncProgressEvent progress, CancellationToken cancellationToken = default);

    /// <summary>
    /// Somebody's hand-entered LP changed.
    ///
    /// Raised by the server rather than by the desktop that typed it, because
    /// the window that has to react is usually not the one that called: the LP
    /// editor is its own renderer with its own cache, and the match list and
    /// rank graph it just changed are in the main window — on this machine and
    /// on everybody else's.
    /// </summary>
    Task RankEditedAsync(Guid riotAccountId, CancellationToken cancellationToken = default);

    /// <summary>A running League client reported a rank that moved.</summary>
    Task RankChangedAsync(Guid riotAccountId, CancellationToken cancellationToken = default);

    /// <summary>
    /// A recording was attached to one account's game, replaced, or taken off it.
    ///
    /// Carries the game as well as the account, because the row it changes is
    /// that account's row for that game and nobody else's.
    /// </summary>
    Task RecordingChangedAsync(Guid riotAccountId, string matchId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Riot has refused this server's key.
    ///
    /// Pushed the moment it happens rather than discovered by a poll, because
    /// the moment it happens is usually the middle of the night — a personal key
    /// expires every twenty-four hours — and the people who need to know are
    /// asleep. The banner is waiting for them.
    /// </summary>
    Task RiotKeyRejectedAsync(CancellationToken cancellationToken = default);
}

/// <summary>Drops everything. For tests, and for anything that runs without a hub.</summary>
public sealed class NullServerEvents : IServerEvents
{
    public Task SyncProgressAsync(SyncProgressEvent progress, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task RankEditedAsync(Guid riotAccountId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task RankChangedAsync(Guid riotAccountId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task RecordingChangedAsync(Guid riotAccountId, string matchId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task RiotKeyRejectedAsync(CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
