using Foxfire.Api.Common;
using Foxfire.Api.Features.ShareLinks;
using Foxfire.Api.Startup;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Share links: making one, checking one, withdrawing one, and the admins' list.
///
/// The link itself — {PublicUrl}/players/{slug}?share={token} — is a page of the
/// web client, which checks the token here once and then sends it with every
/// read as the X-Foxfire-Share header. What a link opens is decided route by
/// route; see Auth/ReaderAccess.cs.
/// </summary>
public static class ShareLinkEndpoints
{
    public static void MapShareLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var shares = app.MapGroup("/shares").WithTags("Share links");

        shares.MapPost("/", (
                    [FromBody] CreateShareLinkRequest request,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(request, cancellationToken))
            .RequireAuthorization();

        // Unauthenticated: whoever follows a share link is, by definition, not
        // signed in to this server.
        shares.MapPost("/open", (
                    [FromBody] OpenShareLinkRequest request,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(request, cancellationToken))
            .RequireRateLimiting(RateLimits.Auth);

        shares.MapDelete("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new RevokeShareLinkRequest(id), cancellationToken))
            .RequireAuthorization();

        app.MapGet("/admin/shares", (
                    int? limit,
                    int? offset,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new ListShareLinksRequest(limit, offset), cancellationToken))
            .WithTags("Share links")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));
    }
}
