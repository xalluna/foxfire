using Foxfire.Api.Common;
using Foxfire.Api.Features.Invites;
using Foxfire.Api.Versioning;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Creating invites, and letting somebody check one.
///
/// The link is clickable as many times as anybody likes; what can only happen
/// once is a registration completing against it. Nothing here spends an invite —
/// that is done by the registration handler, inside the transaction that
/// creates the account.
/// </summary>
public static class InviteEndpoints
{
    public static void MapInviteEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/invites")
            .WithTags("Invites")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new ListInvitesRequest(), cancellationToken));

        admin.MapPost("/", (
                [FromBody] CreateInviteRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        admin.MapDelete("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new RevokeInviteRequest(id), cancellationToken));

        // Unauthenticated and version-free: somebody following a link may not
        // have Foxfire installed yet, which is rather the point of an invite.
        app.MapGet("/invites/{token}/preview", (
                    string token,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new PreviewInviteRequest(token), cancellationToken))
            .AllowAnyDesktopVersion()
            .WithTags("Invites");

        // The one route that answers with a page rather than a payload, so it
        // is the one route that does not go through SendAsync.
        app.MapGet("/invite/{token}", async (string token, ISender sender, CancellationToken cancellationToken) =>
            {
                var page = await sender.Send(new GetInviteLandingPageRequest(token), cancellationToken);
                return Results.Content(page.Data ?? "", "text/html; charset=utf-8");
            })
            .AllowAnyDesktopVersion()
            .ExcludeFromDescription();
    }
}
