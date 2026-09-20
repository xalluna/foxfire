using System.Net;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Auth;

/// <summary>Signing in. The email is the login; the username is a display name.</summary>
public sealed record LoginRequest(string Email, string Password, string? DeviceLabel)
    : IDomainRequest<SessionResponse>;

internal sealed class LoginRequestHandler(UserManager<FoxfireUser> users, TokenService tokens)
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
        if (user is null) return Wrong();

        if (await users.IsLockedOutAsync(user))
        {
            return Response<SessionResponse>.Failure(
                new Error("account_disabled", "That account has been disabled by an administrator."),
                HttpStatusCode.Forbidden);
        }

        if (!await users.CheckPasswordAsync(user, request.Password ?? ""))
        {
            // Feeds Identity's lockout accounting, which is what makes guessing
            // expensive rather than merely slow.
            await users.AccessFailedAsync(user);
            return Wrong();
        }

        await users.ResetAccessFailedCountAsync(user);

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);

        return Sessions.Describe(pair, user, roles);
    }
}
