using Foxfire.Api.Common;
using Foxfire.Api.Features.Meta;
using Foxfire.Api.Versioning;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// The handshake, and the health check.
///
/// Both carry AllowAnyDesktopVersion, which is why a bare curl reaches them and
/// why a desktop too old for this server can still be told so. Every other
/// route answers 426 without a client-version header — including one that does
/// not exist, because the gate sits in front of routing.
/// </summary>
public static class VersionEndpoints
{
    public static void MapVersionEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/version", (ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetVersionRequest(), cancellationToken))
            .AllowAnyDesktopVersion()
            .WithTags("Meta");

        app.MapGet("/health", (ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetHealthRequest(), cancellationToken))
            .AllowAnyDesktopVersion()
            .WithTags("Meta");
    }
}
