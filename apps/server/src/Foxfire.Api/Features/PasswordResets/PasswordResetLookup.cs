using Foxfire.Api.Configuration;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.PasswordResets;

/// <summary>A reset link as the admin who made it sees it.</summary>
/// <param name="Link">
/// The whole point of the shape. This server sends no mail, so the link is
/// readable and copyable — it goes wherever the community actually talks.
/// </param>
public sealed record PasswordResetResponse(
    Guid Id,
    Guid UserId,
    string Link,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt);

/// <summary>
/// Turning a token back into the reset it names, and a reset into the shape an
/// admin reads.
///
/// Shared by four handlers and the user list, which is why it is here rather
/// than private to one of them.
/// </summary>
internal static class PasswordResetLookup
{
    /// <summary>
    /// Resolves a token to a reset, or to the reason there is not one.
    ///
    /// A forged token and an unknown one give the same answer. Anything more
    /// specific is only ever said to a token that verified against this
    /// server's key, and then only about its own state.
    /// </summary>
    public static async Task<(PasswordReset? Reset, string Message)> ResolveAsync(
        string token,
        FoxfireDbContext db,
        AuthOptions auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var verified = ResetToken.Verify(token, auth.InviteSigningKeyBytes, now);

        const string Unknown = "This password reset link is not valid for this server.";
        const string Gone = "This link has expired. Ask whoever sent it for a new one.";

        switch (verified.Status)
        {
            case SignedTokenStatus.Expired:
                return (null, Gone);
            case SignedTokenStatus.Malformed:
            case SignedTokenStatus.BadSignature:
                return (null, Unknown);
            default:
                break;
        }

        var reset = await db.PasswordResets
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == verified.ResetId, cancellationToken);

        if (reset?.User is null) return (null, Unknown);
        if (reset.RedeemedAt is not null) return (null, "This link has already been used.");
        if (reset.RevokedAt is not null) return (null, "This link was withdrawn, or replaced by a newer one.");
        if (reset.ExpiresAt <= now) return (null, Gone);

        if (IsDisabled(reset.User, now))
        {
            return (null, "That account is disabled. Ask an administrator to enable it first.");
        }

        // The stamp is what makes a link stop working when the account moves
        // underneath it — a password, email or username change all rotate it.
        if (!string.Equals(reset.User.SecurityStamp, reset.SecurityStamp, StringComparison.Ordinal))
        {
            return (null, "This link is out of date, because that account has changed since it was made.");
        }

        return (reset, "Ready to use.");
    }

    public static PasswordResetResponse Describe(PasswordReset reset, ServerOptions server, AuthOptions auth)
    {
        ArgumentNullException.ThrowIfNull(reset);
        ArgumentNullException.ThrowIfNull(server);
        ArgumentNullException.ThrowIfNull(auth);

        var token = ResetToken.Issue(reset.Id, reset.ExpiresAt, auth.InviteSigningKeyBytes);

        return new PasswordResetResponse(
            reset.Id,
            reset.UserId,
            Link: $"{server.PublicUrl.TrimEnd('/')}/reset-password/{token}",
            reset.CreatedAt,
            reset.ExpiresAt);
    }

    /// <summary>
    /// Disabled by an admin, which is a lockout with no end date — what
    /// UpdateUserRequest writes.
    ///
    /// A temporary lockout is not the same thing and does not count here. It
    /// lasts five minutes, it is what ten wrong passwords earns, and it is very
    /// often exactly why somebody is asking for a reset link in the first place.
    /// </summary>
    public static bool IsDisabled(FoxfireUser user, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(user);
        return user.LockoutEnd is { } end && end > now.AddYears(1);
    }
}
