using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Foxfire.Api.Sync;

/// <summary>
/// The events the desktop used to raise for itself.
///
/// Named exactly as the IPC channels they replace — sync:progress and the rest —
/// because that is what they are. The desktop's broadcast module fans an event
/// out to every window, and in server mode the same event arrives here first and
/// is handed to the same module; nothing above the transport knows which one
/// delivered it.
///
/// Nobody subscribes to anything. Every member sees every account's data, so
/// there are no groups to join and nothing to filter — a progress event carries
/// the account it is about, which is what the renderer already keys on.
/// </summary>
public static class HubEvents
{
    /// <summary>How far through a sync an account is.</summary>
    public const string SyncProgress = "sync:progress";

    /// <summary>Somebody's hand-entered LP changed, so cached match rows are stale.</summary>
    public const string RankEdited = "rank:edited";

    /// <summary>A running League client reported a new rank.</summary>
    public const string RankChanged = "lcu:rankChanged";

    /// <summary>
    /// Riot has rejected this server's key.
    ///
    /// Same channel the desktop already renders a banner for, deliberately: in
    /// local-only mode it means "your key expired, paste a new one", and here it
    /// means "the host's key expired". The banner text differs; the fact that
    /// reads still work and writes have stopped does not.
    /// </summary>
    public const string KeyInvalid = "settings:keyInvalid";
}

/// <summary>
/// The one hub, for everything the server pushes.
///
/// A single hub rather than one per concern, because the desktop holds a single
/// connection to a single active server and every event on it is addressed the
/// same way. Splitting them would multiply connections without separating
/// anything.
/// </summary>
[Authorize]
public sealed class FoxfireHub : Hub
{
    /// <summary>Where the desktop connects.</summary>
    public const string Path = "/hub";
}

/// <summary>Sends sync progress to everybody connected.</summary>
public sealed class SignalRSyncProgressSink(IHubContext<FoxfireHub> hub) : ISyncProgressSink
{
    public Task PublishAsync(SyncProgressEvent progress, CancellationToken cancellationToken = default) =>
        hub.Clients.All.SendAsync(HubEvents.SyncProgress, progress, cancellationToken);
}
