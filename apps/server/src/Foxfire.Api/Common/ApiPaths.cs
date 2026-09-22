namespace Foxfire.Api.Common;

/// <summary>
/// Where the API lives, now that it shares an origin with the web client.
///
/// Everything a client calls is under <see cref="Base"/>; everything else at the
/// root is the web client's — its pages, and the files they load. The split is
/// what lets one server answer both a desktop asking for <c>/api/search</c> and a
/// browser opening <c>/search</c>.
///
/// <see cref="Version"/> and <see cref="Health"/> are the exception, and a
/// permanent one: they answer at the root as well as under the API, because
/// they are how a client finds out where the API is and whether it is up, and
/// a container orchestrator's health check should not have to change because
/// the API moved.
/// </summary>
public static class ApiPaths
{
    /// <summary>The prefix every API route sits under.</summary>
    public const string Base = "/api";

    /// <summary>The handshake, at the root.</summary>
    public const string Version = "/version";

    /// <summary>The health check, at the root.</summary>
    public const string Health = "/health";

    /// <summary>Whether a path is an API route rather than one of the web client's.</summary>
    public static bool IsApi(PathString path) => path.StartsWithSegments(Base);

    /// <summary>Whether a path is one of the two that answer at the root.</summary>
    public static bool IsRootMeta(PathString path) =>
        path.Equals(Version, StringComparison.OrdinalIgnoreCase)
        || path.Equals(Health, StringComparison.OrdinalIgnoreCase);
}
