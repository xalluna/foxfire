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

        // The open ones, whole: they expire, so there are never many. The
        // collection route answers with them because a POST to it makes one.
        admin.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new ListOpenInvitesRequest(), cancellationToken));

        // The used ones, which are everybody who ever joined this way, a page
        // at a time.
        admin.MapGet("/used", (
                int? limit,
                int? offset,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ListUsedInvitesRequest(limit, offset), cancellationToken));

        admin.MapPost("/", (
                [FromBody] CreateInviteRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        admin.MapDelete("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new RevokeInviteRequest(id), cancellationToken));

        // Unauthenticated and version-free: somebody following a link may not
        // have Foxfire installed yet, which is rather the point of an invite.
        //
        // The link itself — {PublicUrl}/invite/{token} — is not a route here.
        // It is a page of the web client, which reads this preview and offers
        // the sign-up form; the server-rendered page it replaces could only
        // say "open Foxfire".
        app.MapGet("/invites/{token}/preview", (
                    string token,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new PreviewInviteRequest(token), cancellationToken))
            .AllowAnyDesktopVersion()
            .WithTags("Invites");
    }
}
