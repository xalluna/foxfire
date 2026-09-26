using Foxfire.Api.Configuration;
using Foxfire.Api.Features.PasswordResets;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Account;

/// <summary>
/// Turning a confirmation token back into the row it names, and a row into the
/// link that is emailed.
///
/// Shared by the confirm route and the email renderer, which ask the same
/// question — is this link still any good — at different moments.
/// </summary>
internal static class EmailVerificationLookup
{
    /// <summary>
    /// How long a confirmation link works. A week, because it confirms an
    /// address rather than handing an account over — the worst a stale one can
    /// do is prove somebody read their own mail late.
    /// </summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    public static string LinkFor(EmailVerification verification, ServerOptions server, AuthOptions auth)
    {
        ArgumentNullException.ThrowIfNull(verification);
        ArgumentNullException.ThrowIfNull(server);
        ArgumentNullException.ThrowIfNull(auth);

        var token = EmailVerificationToken.Issue(verification.Id, verification.ExpiresAt, auth.InviteSigningKeyBytes);
        return $"{server.PublicUrl.TrimEnd('/')}/verify-email/{token}";
    }

    /// <summary>
    /// Why a confirmation can no longer be used, or null when it still can.
    ///
    /// A <c>verify</c> link confirms the account's own address, so it is dead
    /// once the account has a different one. A <c>change</c> link is pinned to
    /// the security stamp it was made under, as a reset is: a password change in
    /// between is a good reason to stop trusting a request to move the account.
    /// </summary>
    public static string? Unusable(EmailVerification verification, FoxfireUser user, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(verification);
        ArgumentNullException.ThrowIfNull(user);

        if (verification.RedeemedAt is not null) return "This link has already been used.";
        if (verification.RevokedAt is not null) return "This link was replaced by a newer one, or the change was cancelled.";
        if (verification.ExpiresAt <= now) return "This link has expired. Ask for a new one from your account settings.";
        if (PasswordResetLookup.IsDisabled(user, now)) return "That account is disabled.";

        if (verification.Purpose == EmailVerificationPurposes.Verify)
        {
            return string.Equals(user.Email, verification.Email, StringComparison.OrdinalIgnoreCase)
                ? null
                : "This link is for an address that account no longer uses.";
        }

        return string.Equals(user.SecurityStamp, verification.SecurityStamp, StringComparison.Ordinal)
            ? null
            : "This link is out of date, because that account has changed since it was made. Ask for a new one.";
    }

    /// <summary>
    /// Resolves a token to a usable confirmation, or to the reason there is not
    /// one. A forged token and an unknown one get the same answer, as a reset's do.
    /// </summary>
    public static async Task<(EmailVerification? Verification, string Message)> ResolveAsync(
        string? token,
        FoxfireDbContext db,
        AuthOptions auth,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        const string Unknown = "This confirmation link is not valid for this server.";

        var verified = EmailVerificationToken.Verify(token, auth.InviteSigningKeyBytes, now);

        switch (verified.Status)
        {
            case SignedTokenStatus.Expired:
                return (null, "This link has expired. Ask for a new one from your account settings.");
            case SignedTokenStatus.Malformed:
            case SignedTokenStatus.BadSignature:
                return (null, Unknown);
            default:
                break;
        }

        var verification = await db.EmailVerifications
            .Include(v => v.User)
            .FirstOrDefaultAsync(v => v.Id == verified.VerificationId, cancellationToken);

        if (verification?.User is null) return (null, Unknown);

        return Unusable(verification, verification.User, now) is { } reason
            ? (null, reason)
            : (verification, "Ready to use.");
    }
}
