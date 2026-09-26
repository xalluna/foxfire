using Foxfire.Api.Common;
using Foxfire.Api.Features.Account;
using Foxfire.Api.Startup;
using Foxfire.Api.Versioning;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Your own address: whether it is confirmed, the link that confirms it, and a
/// move to a new one that is waiting on its link.
///
/// A group of its own rather than under /auth, so a server from before mail
/// answers the whole of it with the JSON 404 a client reads as "this server
/// cannot do that" — the banner simply does not appear.
///
/// Opening a confirmation link is separate, and open to anybody: whoever opens
/// it may not be signed in on that device, and does not need to be. The link
/// is the proof. Its token travels in the body, never the path.
/// </summary>
public static class AccountEmailEndpoints
{
    public static void MapAccountEmailEndpoints(this IEndpointRouteBuilder app)
    {
        var mine = app.MapGroup("/account/email")
            .WithTags("Account")
            .RequireAuthorization();

        mine.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetAccountEmailRequest(), cancellationToken));

        mine.MapPost("/confirmation", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new ResendEmailConfirmationRequest(), cancellationToken));

        mine.MapDelete("/pending", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new CancelEmailChangeRequest(), cancellationToken));

        app.MapPost("/email-verifications/confirm", (
                    [FromBody] ConfirmEmailRequest request,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(request, cancellationToken))
            .WithTags("Account")
            .AllowAnyDesktopVersion()
            .RequireRateLimiting(RateLimits.Auth);
    }
}
