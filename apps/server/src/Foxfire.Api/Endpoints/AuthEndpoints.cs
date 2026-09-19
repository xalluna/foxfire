using Foxfire.Api.Common;
using Foxfire.Api.Features.Auth;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Registering, signing in, and staying signed in.
///
/// Email is the login and the username is the display name, which is the split
/// asked for: you cannot forget your email, a reset has to go to it anyway, and
/// what shows up next to your games should be yours to pick.
/// </summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/auth").WithTags("Auth");

        auth.MapPost("/register", (
                [FromBody] RegisterRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        auth.MapPost("/login", (
                [FromBody] LoginRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        auth.MapPost("/refresh", (
                [FromBody] RefreshSessionRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        auth.MapPost("/logout", (
                [FromBody] LogoutRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        auth.MapGet("/me", (ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetCurrentUserRequest(), cancellationToken))
            .RequireAuthorization();
    }
}
