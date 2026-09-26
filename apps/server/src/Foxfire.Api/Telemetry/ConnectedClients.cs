using System.Collections.Concurrent;
using Foxfire.Api.Versioning;

namespace Foxfire.Api.Telemetry;

/// <summary>Clients of one kind and version holding the hub open.</summary>
/// <param name="Kind">desktop, web, or unnamed.</param>
/// <param name="Version">A desktop's own version; for the web client, the API version its page was built for.</param>
public sealed record ConnectedGroup(string Kind, string Version, int Count);

/// <summary>
/// Who is connected right now, by the hub connections they hold.
///
/// Every desktop signed in to this server and every open browser tab keeps one
/// hub connection, so counting them is counting who is here — and, because a
/// desktop names its version, which versions a host's community is running.
/// That is the number that says whether an update has reached everybody yet.
///
/// Counts only. Which member holds which connection is not kept.
/// </summary>
public sealed class ConnectedClients
{
    private readonly ConcurrentDictionary<string, (string Kind, string Version)> _connections = new();

    public void Connected(string connectionId, ClientIdentity identity)
    {
        ArgumentNullException.ThrowIfNull(identity);

        _connections[connectionId] = identity switch
        {
            ClientIdentity.Desktop desktop => ("desktop", desktop.Version),
            ClientIdentity.Web web => ("web", web.ApiVersion is { } api ? $"api {api}" : "api ?"),
            _ => ("unnamed", "")
        };
    }

    public void Disconnected(string connectionId) => _connections.TryRemove(connectionId, out _);

    /// <summary>Right now, grouped, biggest first.</summary>
    public IReadOnlyList<ConnectedGroup> Snapshot() =>
    [
        .. _connections.Values
            .GroupBy(c => c)
            .Select(g => new ConnectedGroup(g.Key.Kind, g.Key.Version, g.Count()))
            .OrderByDescending(g => g.Count)
            .ThenBy(g => g.Kind, StringComparer.Ordinal)
            .ThenBy(g => g.Version, StringComparer.Ordinal)
    ];
}
