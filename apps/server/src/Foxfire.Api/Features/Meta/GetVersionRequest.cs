using System.Reflection;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Services;
using Foxfire.Core;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Meta;

/// <summary>What a desktop needs to know before it tries to log in.</summary>
/// <param name="ServerName">What this community calls itself.</param>
/// <param name="ServerVersion">The build running here.</param>
/// <param name="ApiVersion">The contract version. Bumps only on a breaking change.</param>
/// <param name="MinimumDesktop">Oldest desktop this server serves.</param>
/// <param name="RecommendedDesktop">Newest desktop this server knows about.</param>
/// <param name="PublicSignup">Whether anybody can register, or an invite is needed.</param>
public sealed record VersionResponse(
    string ServerName,
    string ServerVersion,
    int ApiVersion,
    string MinimumDesktop,
    string RecommendedDesktop,
    bool PublicSignup);

/// <summary>
/// The handshake.
///
/// Answers without authentication and without a client-version header, which is
/// the entire point of it. A desktop that is too old has to be able to find
/// that out and say so — "this server needs Foxfire 0.13" — before somebody
/// types a password and gets an error they cannot act on. There is no
/// auto-update yet, so the message is the whole remedy.
///
/// It gives away the server's name, its version and whether signup is open. All
/// three are things anybody who could register would see anyway, and none of
/// them says who is on it.
/// </summary>
public sealed record GetVersionRequest : IDomainRequest<VersionResponse>;

internal sealed class GetVersionRequestHandler(IOptions<ServerOptions> server, ServerSettingsService settings)
    : IDomainRequestHandler<GetVersionRequest, VersionResponse>
{
    private static readonly string Build =
        Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion.Split('+')[0]
        ?? "0.0.0";

    public async Task<Response<VersionResponse>> Handle(
        GetVersionRequest request,
        CancellationToken cancellationToken) =>
        new VersionResponse(
            ServerName: server.Value.Name,
            ServerVersion: Build,
            ApiVersion: DesktopCompatibility.ApiVersion,
            MinimumDesktop: DesktopCompatibility.AllowList.Minimum,
            RecommendedDesktop: DesktopCompatibility.AllowList.Recommended,
            PublicSignup: await settings.IsPublicSignupEnabledAsync(cancellationToken));
}

/// <summary>Whether the server can currently reach Riot, and how busy the queue is.</summary>
public sealed record HealthResponse(string Status, bool RiotKeyRejected, int QueueDepth);

/// <summary>The health check, which a container orchestrator and a curl both read.</summary>
public sealed record GetHealthRequest : IDomainRequest<HealthResponse>;

internal sealed class GetHealthRequestHandler(Foxfire.Riot.RiotClient riot)
    : IDomainRequestHandler<GetHealthRequest, HealthResponse>
{
    public Task<Response<HealthResponse>> Handle(GetHealthRequest request, CancellationToken cancellationToken)
    {
        // Degraded rather than unhealthy when Riot has refused the key.
        // Everything already stored still reads; what is lost is new data. A
        // container orchestrator restarting the server over this would achieve
        // nothing — the key is configuration, and the new process would come up
        // holding the same dead one.
        var rejected = riot.KeyRejected;

        return Task.FromResult<Response<HealthResponse>>(new HealthResponse(
            Status: rejected ? "degraded" : "healthy",
            RiotKeyRejected: rejected,
            QueueDepth: riot.Limiter.QueueDepth));
    }
}
