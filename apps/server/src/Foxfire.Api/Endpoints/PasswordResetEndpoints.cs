using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Features.PasswordResets;
using Foxfire.Api.Startup;
using Foxfire.Api.Versioning;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Reset links: making one, withdrawing it, and using it.
///
/// The two admin routes hang off the member they are about, because that is
/// what they are — one more thing an admin can do to somebody, beside promoting
/// and disabling them. There is at most one live link per account, so neither
/// route needs to name which link it means.
///
/// The two public routes are how the link gets used, and they are open for the
/// same reason the invite preview is: whoever follows one cannot sign in, which
/// is the entire problem. They are rate limited, unlike the invite preview —
/// an invite makes an account, this takes one over.
///
/// The link itself — {PublicUrl}/reset-password/{token} — is not a route here.
/// It is a page of the web client, which reads the preview and offers the form.
/// </summary>
public static class PasswordResetEndpoints
{
    public static void MapPasswordResetEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/users/{id:guid}/password-reset")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapPost("/", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new CreatePasswordResetRequest(id), cancellationToken));

        admin.MapDelete("/", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new RevokePasswordResetRequest(id), cancellationToken));

        var links = app.MapGroup("/password-resets").WithTags("Password resets");

        links.MapGet("/{token}/preview", (string token, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new PreviewPasswordResetRequest(token), cancellationToken))
            .AllowAnyDesktopVersion()
            .RequireRateLimiting(RateLimits.Auth);

        links.MapPost("/{token}/redeem", async (
                    string token,
                    [FromBody] RedeemPasswordResetRequest request,
                    HttpContext http,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                SessionTransport.Deliver(
                    http, await sender.Send(request with { Token = token }, cancellationToken)))
            .AllowAnyDesktopVersion()
            .RequireRateLimiting(RateLimits.Auth);
    }
}
