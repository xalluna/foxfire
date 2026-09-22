using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Auth;
using Foxfire.Api.Startup;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Registering, signing in, and staying signed in.
///
/// Email is the login and the username is the display name, which is the split
/// asked for: you cannot forget your email, a reset has to go to it anyway, and
/// what shows up next to your games should be yours to pick.
///
/// How the refresh token travels depends on who is asking — in the body for a
/// desktop, as a cookie for the web client — and that is settled here, at the
/// edge, by SessionTransport. The handlers never know which it was.
///
/// Signing in and registering are rate limited per address; refreshing and
/// signing out are not. A household behind one address reloading a few tabs at
/// once must not lock itself out, and a refresh token is not something anybody
/// can guess their way into.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/auth").WithTags("Auth");

        auth.MapPost("/register", async (
                [FromBody] RegisterRequest request,
                HttpContext http,
                ISender sender,
                CancellationToken cancellationToken) =>
            SessionTransport.Deliver(http, await sender.Send(request, cancellationToken)))
            .RequireRateLimiting(RateLimits.Auth);

        auth.MapPost("/login", async (
                [FromBody] LoginRequest request,
                HttpContext http,
                ISender sender,
                CancellationToken cancellationToken) =>
            SessionTransport.Deliver(http, await sender.Send(request, cancellationToken)))
            .RequireRateLimiting(RateLimits.Auth);

        // No [FromBody] on these two: the web client's refresh token is its
        // cookie, so it posts no body, and SessionTransport reads a desktop's
        // body itself — it says why.
        auth.MapPost("/refresh", async (
                HttpContext http,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var token = await SessionTransport.RefreshTokenFromAsync(http, cancellationToken);
                return SessionTransport.Deliver(http, await sender.Send(new RefreshSessionRequest(token), cancellationToken));
            });

        auth.MapPost("/logout", async (
                HttpContext http,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                var token = await SessionTransport.RefreshTokenFromAsync(http, cancellationToken);
                var result = await sender.SendAsync(new LogoutRequest(token), cancellationToken);
                SessionTransport.Forget(http);
                return result;
            });

        auth.MapGet("/me", (ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetCurrentUserRequest(), cancellationToken))
            .RequireAuthorization();
    }
}
