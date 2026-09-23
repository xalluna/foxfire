using System.Net;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Auth;

/// <summary>Signing in. The email is the login; the username is a display name.</summary>
public sealed record LoginRequest(string Email, string Password, string? DeviceLabel)
    : IDomainRequest<SessionResponse>;

internal sealed class LoginRequestHandler(
    UserManager<FoxfireUser> users,
    TokenService tokens,
    ILogger<LoginRequestHandler> logger)
    : IDomainRequestHandler<LoginRequest, SessionResponse>
{
    /// <summary>
    /// One answer for "no such account" and "wrong password", so this cannot be
    /// used to find out who has an account here.
    /// </summary>
    private static Response<SessionResponse> Wrong() =>
        Response<SessionResponse>.Failure(
            new Error("invalid_credentials", "Wrong email or password."), HttpStatusCode.Unauthorized);

    public async Task<Response<SessionResponse>> Handle(LoginRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await users.FindByEmailAsync((request.Email ?? "").Trim());
        if (user is null)
        {
            // Without the address. What gets typed into an email box by mistake
            // is, often enough, a password.
            logger.LogInformation("Sign-in refused: no account has that email");
            return Wrong();
        }

        if (await users.IsLockedOutAsync(user))
        {
            logger.LogInformation("Sign-in refused: {Username} is disabled or locked out", user.UserName);
            return Response<SessionResponse>.Failure(
                new Error("account_disabled", "That account has been disabled by an administrator."),
                HttpStatusCode.Forbidden);
        }

        if (!await users.CheckPasswordAsync(user, request.Password ?? ""))
        {
            // Feeds Identity's lockout accounting, which is what makes guessing
            // expensive rather than merely slow.
            await users.AccessFailedAsync(user);

            if (await users.IsLockedOutAsync(user))
            {
                logger.LogWarning(
                    "{Username} is locked out after too many wrong passwords, until {LockoutEnd}",
                    user.UserName,
                    user.LockoutEnd);
            }
            else
            {
                logger.LogInformation(
                    "Sign-in refused: wrong password for {Username} ({Failures} in a row)",
                    user.UserName,
                    user.AccessFailedCount);
            }

            return Wrong();
        }

        await users.ResetAccessFailedCountAsync(user);

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);

        logger.LogInformation("{Username} signed in on {Device}", user.UserName, request.DeviceLabel ?? "an unnamed device");

        return Sessions.Describe(pair, user, roles);
    }
}
