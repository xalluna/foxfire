using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.PasswordResets;

/// <summary>What the sign-in page says after "Forgot password?", whatever happened.</summary>
public sealed record PasswordResetRequestedResponse(string Message);

/// <summary>
/// "Forgot password?" — a reset link, emailed to the address on the account.
///
/// Anybody can ask, so the answer is the same whatever the case: an address
/// with no account here, one that has never been confirmed and one that has
/// all read "if there is an account, a link is on its way". Anything else would
/// let a stranger find out who is on a private server.
///
/// It only ever goes to a confirmed address. A reset link takes the account
/// over, and an address nobody has shown they read may be a typo that belongs
/// to somebody else. A member who never confirmed theirs asks an admin, as
/// everybody did before the server sent mail.
///
/// And it goes once. While a link is live and the email carrying it is still
/// on its way or has arrived, asking again sends nothing — the link already
/// sent is the one to use. Otherwise a stranger with a list of addresses could
/// spend the day's allowance, and bury a member's inbox, one click at a time.
/// Somebody who deleted the email waits for the link to lapse; that is the
/// price, and it is a small one.
/// </summary>
public sealed record RequestPasswordResetRequest(string Email) : IDomainRequest<PasswordResetRequestedResponse>;

internal sealed class RequestPasswordResetRequestHandler(
    FoxfireDbContext db,
    UserManager<FoxfireUser> users,
    EmailOutbox outbox,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<RequestPasswordResetRequestHandler> logger)
    : IDomainRequestHandler<RequestPasswordResetRequest, PasswordResetRequestedResponse>
{
    /// <summary>The one answer, whatever happened.</summary>
    private static Response<PasswordResetRequestedResponse> Asked() =>
        Response<PasswordResetRequestedResponse>.Success(
            new PasswordResetRequestedResponse(
                "If an account on this server uses that address and has confirmed it, a link to reset its password "
                + "is on its way. It works for a day. Nothing arrived? Check your spam folder, or ask this server's "
                + "administrator."),
            HttpStatusCode.Accepted);

    public async Task<Response<PasswordResetRequestedResponse>> Handle(
        RequestPasswordResetRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Not a secret: whether a server sends mail is on its /version.
        if (!outbox.IsEnabled)
        {
            return new Error(
                "email_unavailable",
                "This server doesn't send email, so it can't send you a reset link. Ask its administrator for one.");
        }

        var email = (request.Email ?? "").Trim();
        if (email.Length == 0 || !email.Contains('@', StringComparison.Ordinal))
        {
            return new Error("invalid_email", "That does not look like an email address.");
        }

        var user = await users.FindByEmailAsync(email);
        var now = time.GetUtcNow();

        if (user is null || !user.EmailConfirmed || PasswordResetLookup.IsDisabled(user, now))
        {
            // Without the address when there is no account: what gets typed into
            // an email box by mistake is, often enough, somebody else's.
            logger.LogInformation(
                "A password reset was asked for an address with no confirmed, enabled account here");
            return Asked();
        }

        if (await outbox.IsSuppressedAsync(email, cancellationToken))
        {
            logger.LogInformation("{Username} asked for a reset link, but mail to their address bounces", user.UserName);
            return Asked();
        }

        if (await HasLiveMailedLinkAsync(user, now, cancellationToken))
        {
            logger.LogInformation(
                "{Username} asked for a reset link again; the one already sent is still live, so nothing was sent",
                user.UserName);
            return Asked();
        }

        // One live link per account, as when an admin makes one.
        await db.PasswordResets
            .Where(r => r.UserId == user.Id && r.RedeemedAt == null && r.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, (DateTimeOffset?)now), cancellationToken);

        var reset = new PasswordReset
        {
            Id = Guid.CreateVersion7(now),
            UserId = user.Id,
            CreatedByUserId = user.Id,
            CreatedAt = now,
            ExpiresAt = now + auth.Value.PasswordResetLifetime,
            SecurityStamp = user.SecurityStamp ?? ""
        };

        db.PasswordResets.Add(reset);

        await outbox.AddAsync(
            EmailKinds.PasswordReset,
            EmailPriority.Security,
            user.Email!,
            relatedId: reset.Id,
            userId: user.Id,
            triggeredBy: null,
            worthlessAfter: reset.ExpiresAt,
            cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        logger.LogWarning("{Username} asked for a password reset link by email", user.UserName);

        return Asked();
    }

    /// <summary>
    /// Whether a link is out that still works and whose email is waiting, on its
    /// way or delivered. One whose email failed, bounced or was dropped does not
    /// count — nothing reached them, so asking again should.
    /// </summary>
    private async Task<bool> HasLiveMailedLinkAsync(FoxfireUser user, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var stamp = user.SecurityStamp ?? "";

        var live = await db.PasswordResets
            .Where(r => r.UserId == user.Id && r.RedeemedAt == null && r.RevokedAt == null && r.ExpiresAt > now)
            .Where(r => r.SecurityStamp == stamp)
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        if (live.Count == 0) return false;

        return await db.EmailMessages.AnyAsync(
            m => m.Kind == EmailKinds.PasswordReset
                 && m.RelatedId != null
                 && live.Contains(m.RelatedId.Value)
                 && (m.Status == EmailStatuses.Queued
                     || m.Status == EmailStatuses.Sending
                     || m.Status == EmailStatuses.Held
                     || m.Status == EmailStatuses.Sent
                     || m.Status == EmailStatuses.Delivered),
            cancellationToken);
    }
}
