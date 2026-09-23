using System.Net;
using System.Text.Json.Serialization;
using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Features.Account;
using Foxfire.Api.Features.Auth;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.PasswordResets;

/// <summary>
/// Sets the new password a link was made for, and signs them in with it.
///
/// Signed in, because opening the link is the proof: nobody else could have
/// reached this point, and asking somebody to type the password they invented
/// four seconds ago into a sign-in form proves nothing further. Every session
/// that existed before this is ended — the point of a reset is usually that
/// somebody else might have had the old password.
/// </summary>
/// <param name="DeviceLabel">What the session list calls the machine they are signing in on.</param>
public sealed record RedeemPasswordResetRequest(string NewPassword, string? DeviceLabel)
    : IDomainRequest<SessionResponse>
{
    /// <summary>Which link. From the route rather than the body, so it is not bound from JSON.</summary>
    [JsonIgnore]
    public string Token { get; init; } = "";
}

internal sealed class RedeemPasswordResetRequestHandler(
    FoxfireDbContext db,
    UserManager<FoxfireUser> users,
    TokenService tokens,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<RedeemPasswordResetRequestHandler> logger)
    : IDomainRequestHandler<RedeemPasswordResetRequest, SessionResponse>
{
    public async Task<Response<SessionResponse>> Handle(
        RedeemPasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (reset, message) = await PasswordResetLookup.ResolveAsync(
            request.Token, db, auth.Value, time, cancellationToken);

        if (reset?.User is not { } user)
        {
            return Response<SessionResponse>.Failure(
                new Error("reset_not_usable", message), HttpStatusCode.BadRequest);
        }

        var now = time.GetUtcNow();

        // Spending the link and setting the password have to stand or fall
        // together. Spending first and failing on a password Identity refuses
        // would burn somebody's only link on a typo; setting first and losing
        // the race would change a password and then say the link was used.
        //
        // The transaction goes inside the retrying execution strategy for the
        // reason registration's does: the strategy refuses to sit inside a
        // transaction it did not open.
        var failure = await db.Database.CreateExecutionStrategy().ExecuteAsync(
            async ct =>
            {
                await using var transaction = await db.Database.BeginTransactionAsync(ct);

                // A conditional UPDATE rather than a read-then-write: two people
                // opening the same link both read it as open a moment ago, and
                // this is the write that decides.
                var spent = await db.PasswordResets
                    .Where(r => r.Id == reset.Id && r.RedeemedAt == null && r.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(r => r.RedeemedAt, (DateTimeOffset?)now), ct);

                if (spent == 0)
                {
                    await transaction.RollbackAsync(ct);
                    return new Error("reset_already_used", "That link has already been used.");
                }

                // Identity's own reset rather than a hand-written hash: it
                // applies the password rules, rotates the security stamp, and
                // the rotation is what puts every other link to this account out
                // of date.
                var identityToken = await users.GeneratePasswordResetTokenAsync(user);
                var applied = await users.ResetPasswordAsync(user, identityToken, request.NewPassword ?? "");

                if (!applied.Succeeded)
                {
                    await transaction.RollbackAsync(ct);
                    return Accounts.Refused(applied, "weak_password");
                }

                await transaction.CommitAsync(ct);
                return (Error?)null;
            },
            cancellationToken);

        if (failure is not null) return Response<SessionResponse>.Failure(failure);

        // Ten wrong guesses before giving up and asking for a link is exactly
        // how somebody arrives here, and the five-minute lockout that earned
        // them should not outlive the password it was guarding.
        if (user.AccessFailedCount > 0 || user.LockoutEnd is not null)
        {
            await users.ResetAccessFailedCountAsync(user);
            await users.SetLockoutEndDateAsync(user, null);
        }

        await tokens.RevokeAllAsync(user.Id, cancellationToken);

        var roles = await users.GetRolesAsync(user);
        var pair = await tokens.IssueAsync(user, roles, request.DeviceLabel, cancellationToken);

        logger.LogWarning(
            "{Username} set a new password with a reset link; every session on the account was ended",
            user.UserName);

        return Sessions.Describe(pair, user, roles);
    }
}
