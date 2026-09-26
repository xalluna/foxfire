using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Account;

/// <param name="Email">The address now confirmed — for a move, the new one.</param>
/// <param name="Purpose">verify, for the address the account had; change, for a move to a new one.</param>
public sealed record ConfirmEmailResponse(string ServerName, string Email, string Purpose, string Message);

/// <summary>
/// Opening the link in a confirmation email.
///
/// No sign-in needed, and none asked for: opening the link is the proof — only
/// somebody who can read that address's mail has it. For a <c>verify</c> link
/// that is the end of it. For a <c>change</c>, this is the moment the account
/// moves: every rule a move has to meet is checked again here, because the
/// address may have been taken, or the account changed, since the link was
/// sent.
///
/// The token comes in the body, never the path. A path is a request line, and a
/// request line is kept and shown to admins.
/// </summary>
public sealed record ConfirmEmailRequest(string Token) : IDomainRequest<ConfirmEmailResponse>;

internal sealed class ConfirmEmailRequestHandler(
    FoxfireDbContext db,
    UserManager<FoxfireUser> users,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    IOptions<AdminOptions> admin,
    TimeProvider time,
    ILogger<ConfirmEmailRequestHandler> logger)
    : IDomainRequestHandler<ConfirmEmailRequest, ConfirmEmailResponse>
{
    public async Task<Response<ConfirmEmailResponse>> Handle(
        ConfirmEmailRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var now = time.GetUtcNow();
        var (verification, message) = await EmailVerificationLookup.ResolveAsync(
            request.Token, db, auth.Value, now, cancellationToken);

        if (verification?.User is not { } user)
        {
            return Response<ConfirmEmailResponse>.Failure(new Error("confirmation_not_usable", message));
        }

        return verification.Purpose == EmailVerificationPurposes.Change
            ? await MoveAsync(verification, user, now, cancellationToken)
            : await ConfirmAsync(verification, user, now, cancellationToken);
    }

    private async Task<Response<ConfirmEmailResponse>> ConfirmAsync(
        EmailVerification verification,
        FoxfireUser user,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // A conditional update, so two clicks confirm once and the second is
        // told why nothing happened.
        var spent = await db.EmailVerifications
            .Where(v => v.Id == verification.Id && v.RedeemedAt == null && v.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(v => v.RedeemedAt, (DateTimeOffset?)now), cancellationToken);

        if (spent == 0)
        {
            return Response<ConfirmEmailResponse>.Failure(
                new Error("confirmation_not_usable", "This link has already been used."));
        }

        // Straight to the column, and only while the account still has this
        // address. Through the user manager it would be a read-modify-write
        // against a concurrency stamp another tab may have moved.
        await db.Users
            .Where(u => u.Id == user.Id && u.NormalizedEmail == verification.Email.ToUpperInvariant())
            .ExecuteUpdateAsync(s => s.SetProperty(u => u.EmailConfirmed, true), cancellationToken);

        await db.EmailVerifications
            .Where(v => v.UserId == user.Id && v.Purpose == EmailVerificationPurposes.Verify)
            .Where(v => v.RedeemedAt == null && v.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(v => v.RevokedAt, (DateTimeOffset?)now), cancellationToken);

        logger.LogInformation("{Username} confirmed their email {Email}", user.UserName, verification.Email);

        return new ConfirmEmailResponse(
            server.Value.Name,
            verification.Email,
            verification.Purpose,
            "Your email is confirmed. If you ever forget your password, you can reset it yourself from the sign-in page.");
    }

    private async Task<Response<ConfirmEmailResponse>> MoveAsync(
        EmailVerification verification,
        FoxfireUser user,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var configured = admin.Value.Email;

        if (Accounts.IsConfiguredAdmin(user.Email, configured))
        {
            return Response<ConfirmEmailResponse>.Failure(new Error(
                "admin_email_pinned",
                "This server's configuration names this account's address as its administrator, so it is set there rather than here."));
        }

        if (Accounts.IsConfiguredAdmin(verification.Email, configured)
            && !await users.IsInRoleAsync(user, FoxfireRoles.HeadAdmin))
        {
            return Response<ConfirmEmailResponse>.Failure(
                new Error("admin_email_reserved", "That address is reserved for this server's administrator."));
        }

        var previous = user.Email;

        // Spending the link and moving the account stand or fall together, as a
        // reset's do: a link spent on a move Identity then refused would leave
        // somebody asking for another for no reason.
        var failure = await db.Database.CreateExecutionStrategy().ExecuteAsync(
            async ct =>
            {
                await using var transaction = await db.Database.BeginTransactionAsync(ct);

                var spent = await db.EmailVerifications
                    .Where(v => v.Id == verification.Id && v.RedeemedAt == null && v.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(v => v.RedeemedAt, (DateTimeOffset?)now), ct);

                if (spent == 0)
                {
                    await transaction.RollbackAsync(ct);
                    return new Error("confirmation_not_usable", "This link has already been used.");
                }

                // Identity checks the address is free, and rotates the stamp —
                // which ends any reset link that was out for the old address.
                var set = await users.SetEmailAsync(user, verification.Email);
                if (!set.Succeeded)
                {
                    await transaction.RollbackAsync(ct);
                    return set.Errors.Any(e => e.Code == "DuplicateEmail")
                        ? new Error("email_taken", "Somebody on this server signed up with that address since you asked to move to it.")
                        : Accounts.Refused(set, "email_change_failed");
                }

                user.EmailConfirmed = true;
                var confirmed = await users.UpdateAsync(user);
                if (!confirmed.Succeeded)
                {
                    await transaction.RollbackAsync(ct);
                    return Accounts.Refused(confirmed, "email_change_failed");
                }

                await db.EmailVerifications
                    .Where(v => v.UserId == user.Id && v.RedeemedAt == null && v.RevokedAt == null)
                    .ExecuteUpdateAsync(s => s.SetProperty(v => v.RevokedAt, (DateTimeOffset?)now), ct);

                await transaction.CommitAsync(ct);
                return (Error?)null;
            },
            cancellationToken);

        if (failure is not null) return Response<ConfirmEmailResponse>.Failure(failure, StatusFor(failure));

        logger.LogInformation(
            "{Username} moved their email from {Previous} to {Email}, confirmed by the link sent there",
            user.UserName, previous, verification.Email);

        return new ConfirmEmailResponse(
            server.Value.Name,
            verification.Email,
            verification.Purpose,
            "Done — you sign in with this address from now on.");
    }

    private static HttpStatusCode StatusFor(Error error) =>
        error.Code == "email_taken" ? HttpStatusCode.Conflict : HttpStatusCode.BadRequest;
}
