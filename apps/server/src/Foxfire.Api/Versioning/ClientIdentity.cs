using System.Globalization;
using Foxfire.Api.Sync;

namespace Foxfire.Api.Versioning;

/// <summary>
/// Who a request says it comes from.
///
/// Two kinds of client, which name themselves differently and are judged
/// differently — see <see cref="DesktopVersionGate"/>. A desktop sends its own
/// version. The web client sends <c>web</c> and the API version the page was
/// built against, because its version is this server's own.
///
/// packages/core/src/server/identity.ts is the other half of this, and the
/// header names and query keys here are the ones it sends.
/// </summary>
public abstract record ClientIdentity
{
    /// <summary>What every client names itself in: a desktop's version, or <c>web</c>.</summary>
    public const string HeaderName = "X-Foxfire-Client";

    /// <summary>Sent beside <c>X-Foxfire-Client: web</c>: the API version the page was built against.</summary>
    public const string ApiVersionHeaderName = "X-Foxfire-Api-Version";

    /// <summary>What the web client puts where a desktop puts its version.</summary>
    public const string WebClientName = "web";

    private const string ClientQueryKey = "client";
    private const string ApiVersionQueryKey = "apiVersion";

    private ClientIdentity()
    {
    }

    /// <summary>A desktop, claiming a version — judged against the allow list.</summary>
    public sealed record Desktop(string Version) : ClientIdentity;

    /// <summary>The web client, and the API version it was built against, if it said one that parses.</summary>
    public sealed record Web(int? ApiVersion) : ClientIdentity;

    /// <summary>Nothing claimed at all — a curl, a crawler, something that is not Foxfire.</summary>
    public sealed record Unnamed : ClientIdentity;

    /// <summary>
    /// Reads who a request claims to be.
    ///
    /// From the headers, except on the hub: a browser cannot put a header on a
    /// WebSocket, so the web client names itself in the hub's query string
    /// instead. Only the web client does — a desktop's socket is opened by Node,
    /// which sends the header like any other request — so the query is only
    /// believed when it says <c>web</c>.
    /// </summary>
    public static ClientIdentity Read(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var client = request.Headers[HeaderName].ToString();
        var apiVersion = request.Headers[ApiVersionHeaderName].ToString();

        if (string.IsNullOrWhiteSpace(client)
            && request.Path.StartsWithSegments(FoxfireHub.Path)
            && request.Query[ClientQueryKey] == WebClientName)
        {
            client = WebClientName;
            apiVersion = request.Query[ApiVersionQueryKey].ToString();
        }

        if (string.IsNullOrWhiteSpace(client)) return new Unnamed();
        if (client != WebClientName) return new Desktop(client);

        return int.TryParse(apiVersion, NumberStyles.None, CultureInfo.InvariantCulture, out var version)
            ? new Web(version)
            : new Web(null);
    }

    /// <summary>Whether a request comes from the web client.</summary>
    public static bool IsWeb(HttpRequest request) => Read(request) is Web;
}
