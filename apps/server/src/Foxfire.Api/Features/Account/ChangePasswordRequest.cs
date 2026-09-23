using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Auth;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Changing your own password, which ends every other session on the account.
///
/// The current password is asked for because a session is not proof of the
/// person: somebody at an unlocked browser has one. It is also what makes the
/// answer worth anything — after this, a password that leaked is no use, and
/// that is only true if every device holding a token minted from it is cut.
///
/// So this revokes the lot, the caller's included, and hands back a fresh pair
/// in the same answer. The device in front of somebody stays signed in; the
/// others are asking for a password within the access token's fifteen minutes.
/// </summary>
/// <param name="DeviceLabel">What the session list calls the machine keeping the new pair.</param>
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword, string? DeviceLabel)
    : IDomainRequest<SessionResponse>;

internal sealed class ChangePasswordRequestHandler(
    UserManager<FoxfireUser> users,
    TokenService tokens,
    IIdentityContext me,
    ILogger<ChangePasswordRequestHandler> logger)
    : IDomainRequestHandler<ChangePasswordRequest, SessionResponse>
{
    public async Task<Response<SessionResponse>> Handle(
        ChangePasswordRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var user = await Accounts.SignedInAsync(users, me);
        if (user is null) return Accounts.SignedOut<SessionResponse>();

        var changed = await users.ChangePasswordAsync(
            user, request.CurrentPassword ?? "", request.NewPassword ?? "");

        if (!changed.Succeeded)
        {
            // Two failures with two meanings: the current password was wrong,
            // which is somebody mistyping, and the new one was refused, which is
            // Identity's length rule. A client can put each under its own box,
            // so they do not share a code.
            return changed.Errors.Any(e => e.Code == "PasswordMismatch")
                ? Response<SessionResponse>.Failure(Accounts.WrongPassword)
                : Accounts.Refused(changed, "weak_password");
        }

        // Before the new pair is minted, so that the pair this answer carries is
        // the only live one on the account.
        await tokens.RevokeAllAsync(user.Id, cancellationToken);

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);

        logger.LogInformation(
            "{Username} changed their password; every other session was ended", user.UserName);

        return Sessions.Describe(pair, user, roles);
    }
}
