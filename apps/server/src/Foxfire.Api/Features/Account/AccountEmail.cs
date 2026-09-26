using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Account;

/// <summary>Somebody's own address, as their account settings show it.</summary>
/// <param name="EmailConfirmed">Whether they have shown they read mail sent to <paramref name="Email"/>.</param>
/// <param name="PendingEmail">The address they asked to move to, while it waits to be confirmed.</param>
/// <param name="LastSentAt">When the newest confirmation link was made, of either kind.</param>
/// <param name="CanResendAt">When another link may be asked for, or null when one may be now.</param>
/// <param name="MailEnabled">Whether this server sends mail at all. Nothing here can be confirmed without it.</param>
/// <param name="Suppressed">Mail to their address bounced or was reported, and is no longer sent.</param>
public sealed record AccountEmailResponse(
    string Email,
    bool EmailConfirmed,
    string? PendingEmail,
    DateTimeOffset? PendingExpiresAt,
    DateTimeOffset? LastSentAt,
    DateTimeOffset? CanResendAt,
    bool MailEnabled,
    bool Suppressed);

/// <summary>
/// Confirming addresses: making the links, and how often somebody may ask.
///
/// Five a day and one every ten minutes. The caller is signed in, so there is
/// nobody to guess at — the limit is there because every link is a message
/// against the day's allowance, and because an address somebody is asking to
/// move to can be anybody's.
/// </summary>
internal static class AccountEmail
{
    public const int DailyLinks = 5;
    public static readonly TimeSpan ResendGap = TimeSpan.FromMinutes(10);

    /// <summary>The move to a new address still waiting on it, if there is one that can still complete.</summary>
    public static Task<EmailVerification?> PendingChangeAsync(
        FoxfireDbContext db,
        FoxfireUser user,
        DateTimeOffset now,
        CancellationToken cancellationToken) =>
        db.EmailVerifications
            .AsNoTracking()
            .Where(v => v.UserId == user.Id && v.Purpose == EmailVerificationPurposes.Change)
            .Where(v => v.RedeemedAt == null && v.RevokedAt == null && v.ExpiresAt > now)
            .Where(v => v.SecurityStamp == user.SecurityStamp)
            .OrderByDescending(v => v.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>
    /// When the next link may be made, or null for now.
    /// </summary>
    /// <param name="gap">Whether the ten minutes between links applies. Moving to a new address is not held to it — a typo wants correcting at once — only to the daily count.</param>
    public static async Task<DateTimeOffset?> NextAllowedAsync(
        FoxfireDbContext db,
        Guid userId,
        DateTimeOffset now,
        bool gap,
        CancellationToken cancellationToken)
    {
        var dayAgo = now.AddDays(-1);
        var recent = await db.EmailVerifications
            .AsNoTracking()
            .Where(v => v.UserId == userId && v.CreatedAt > dayAgo)
            .OrderBy(v => v.CreatedAt)
            .Select(v => v.CreatedAt)
            .ToListAsync(cancellationToken);

        DateTimeOffset? next = null;

        if (gap && recent.Count > 0 && recent[^1] + ResendGap > now) next = recent[^1] + ResendGap;

        if (recent.Count >= DailyLinks)
        {
            var reopens = recent[^DailyLinks].AddDays(1);
            if (next is null || reopens > next) next = reopens;
        }

        return next;
    }

    /// <summary>
    /// Makes a confirmation link and queues the email carrying it, withdrawing
    /// any older link of the same kind. Nothing is saved; the caller saves.
    /// </summary>
    public static async Task<EmailVerification> IssueAsync(
        FoxfireDbContext db,
        EmailOutbox outbox,
        FoxfireUser user,
        string purpose,
        string address,
        EmailPriority priority,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);

        var older = await db.EmailVerifications
            .Where(v => v.UserId == user.Id && v.Purpose == purpose && v.RedeemedAt == null && v.RevokedAt == null)
            .Select(v => v.Id)
            .ToListAsync(cancellationToken);

        if (older.Count > 0)
        {
            await db.EmailVerifications
                .Where(v => older.Contains(v.Id))
                .ExecuteUpdateAsync(s => s.SetProperty(v => v.RevokedAt, (DateTimeOffset?)now), cancellationToken);

            var kind = purpose == EmailVerificationPurposes.Change ? EmailKinds.EmailChange : EmailKinds.Verification;
            foreach (var id in older) await outbox.WithdrawAsync(kind, id, "revoked", cancellationToken);
        }

        var verification = new EmailVerification
        {
            Id = Guid.CreateVersion7(now),
            UserId = user.Id,
            Email = address,
            Purpose = purpose,
            SecurityStamp = user.SecurityStamp ?? "",
            CreatedAt = now,
            ExpiresAt = now + EmailVerificationLookup.Lifetime
        };

        db.EmailVerifications.Add(verification);

        await outbox.AddAsync(
            purpose == EmailVerificationPurposes.Change ? EmailKinds.EmailChange : EmailKinds.Verification,
            priority,
            address,
            relatedId: verification.Id,
            userId: user.Id,
            triggeredBy: user.Id,
            worthlessAfter: verification.ExpiresAt,
            cancellationToken);

        return verification;
    }

    public static async Task<AccountEmailResponse> DescribeAsync(
        FoxfireDbContext db,
        EmailOutbox outbox,
        FoxfireUser user,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);

        var pending = await PendingChangeAsync(db, user, now, cancellationToken);

        var last = await db.EmailVerifications
            .AsNoTracking()
            .Where(v => v.UserId == user.Id)
            .OrderByDescending(v => v.CreatedAt)
            .Select(v => (DateTimeOffset?)v.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        var email = user.Email ?? "";

        return new AccountEmailResponse(
            email,
            user.EmailConfirmed,
            pending?.Email,
            pending?.ExpiresAt,
            last,
            await NextAllowedAsync(db, user.Id, now, gap: true, cancellationToken),
            outbox.IsEnabled,
            email.Length > 0 && await outbox.IsSuppressedAsync(email, cancellationToken));
    }
}
