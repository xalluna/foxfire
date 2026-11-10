using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Email;
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
/// <param name="ApiBase">
/// The path every API route sits under. A client that finds this field talks to
/// it; one that does not is talking to a server from before the API moved.
/// </param>
/// <param name="PublicUrl">
/// Where this server's web client lives, as its members reach it. The desktop
/// builds "Copy link" from this rather than from the address it connected with,
/// which may be one only that machine can use.
/// </param>
/// <param name="Email">
/// Whether this server sends mail — and so whether its sign-in page can offer
/// "Forgot password?". Missing from a server from before it could.
/// </param>
/// <param name="PublicAccess">
/// Whether this server can be read without signing in — and so whether the web
/// client opens its pages to somebody who has not, or sends them to sign in.
/// Missing from a server from before it could, which means no.
/// </param>
/// <param name="Games">
/// The games this server offers, by slug, League first — and so which a client
/// offers while it is connected here. League alone unless the host turned TFT
/// on (<see cref="ServerGames"/>). Missing from a server from before TFT,
/// which means League alone.
/// </param>
/// <param name="Recordings">
/// Whether this server keeps recordings — has Foxfire Media configured — and so
/// whether a client offers uploading and watching them. Missing from a server
/// from before it could, which means no.
/// </param>
/// <param name="MediaOrigin">
/// Foxfire Media's origin, while <paramref name="Recordings"/> is on: where its
/// player is framed from. The desktop needs it before it opens one, to let its
/// own window frame it; it is in the web client's CSP anyway.
/// </param>
public sealed record VersionResponse(
    string ServerName,
    string ServerVersion,
    int ApiVersion,
    string MinimumDesktop,
    string RecommendedDesktop,
    bool PublicSignup,
    string ApiBase,
    string PublicUrl,
    bool Email,
    bool PublicAccess,
    IReadOnlyList<string> Games,
    bool Recordings,
    string? MediaOrigin);

/// <summary>
/// The handshake.
///
/// Answers without authentication and without a client-version header, which is
/// the entire point of it. A desktop that is too old has to be able to find
/// that out and say so — "this server needs Foxfire 0.14" — before somebody
/// types a password and gets an error they cannot act on. It is also what a
/// desktop's updater asks, on a schedule and before anybody has signed in:
/// <c>recommendedDesktop</c> is the build it will install.
///
/// It gives away the server's name, its version, whether signup is open,
/// whether it can be read signed out and which games it offers. All of them
/// are things anybody who could register or look would see anyway, and none
/// of them says who is on it.
/// </summary>
public sealed record GetVersionRequest : IDomainRequest<VersionResponse>;

internal sealed class GetVersionRequestHandler(
    IOptions<ServerOptions> server,
    ServerSettingsService settings,
    ActiveEmailProvider email,
    ServerGames games,
    IOptions<MediaOptions> media)
    : IDomainRequestHandler<GetVersionRequest, VersionResponse>
{
    public async Task<Response<VersionResponse>> Handle(
        GetVersionRequest request,
        CancellationToken cancellationToken) =>
        new VersionResponse(
            ServerName: server.Value.Name,
            ServerVersion: ServerBuild.Version,
            ApiVersion: DesktopCompatibility.ApiVersion,
            MinimumDesktop: DesktopCompatibility.AllowList.Minimum,
            RecommendedDesktop: DesktopCompatibility.AllowList.Recommended,
            PublicSignup: await settings.IsPublicSignupEnabledAsync(cancellationToken),
            ApiBase: ApiPaths.Base,
            PublicUrl: server.Value.PublicUrl.TrimEnd('/'),
            Email: email.IsEnabled,
            PublicAccess: await settings.IsPublicAccessEnabledAsync(cancellationToken),
            Games: [.. games.All.Select(game => game.Slug())],
            Recordings: media.Value.IsEnabled,
            MediaOrigin: media.Value.IsEnabled ? media.Value.Origin : null);
}

/// <summary>Whether the server can currently reach Riot, and how busy the queue is.</summary>
/// <param name="TftAccess">
/// Whether this server's key reaches TFT: unknown, granted or denied — or off,
/// when the host has not turned TFT on and so the server never asks.
/// </param>
public sealed record HealthResponse(string Status, bool RiotKeyRejected, int QueueDepth, string TftAccess);

/// <summary>The health check, which a container orchestrator and a curl both read.</summary>
public sealed record GetHealthRequest : IDomainRequest<HealthResponse>;

internal sealed class GetHealthRequestHandler(
    Foxfire.Riot.RiotClient riot,
    Foxfire.Api.Sync.TftAccess tft,
    ServerGames games)
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
            QueueDepth: riot.Limiter.QueueDepth,
            // Never the status: a server whose key has no TFT is a League
            // server, and healthy at being one.
            TftAccess: games.Tft ? tft.Slug : "off"));
    }
}
