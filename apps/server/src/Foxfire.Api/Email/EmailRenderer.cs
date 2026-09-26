using Foxfire.Api.Configuration;
using Foxfire.Api.Features.Account;
using Foxfire.Api.Features.Invites;
using Foxfire.Api.Features.PasswordResets;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Email;

/// <summary>What a queued message turned into at the moment it was due.</summary>
public abstract record EmailRender
{
    public sealed record Ready(OutboundEmail Message) : EmailRender;

    /// <param name="Reason">Why it is no longer worth sending: revoked, used, expired, stale, unverified, gone.</param>
    public sealed record Drop(string Reason) : EmailRender;
}

/// <summary>
/// Builds a queued message's body from the row it is about, at the moment it
/// is sent.
///
/// The body is never stored — see <see cref="EmailMessage"/> — so it is made
/// here, and made again on every retry. That is only safe because it comes out
/// the same each time: links are signatures over their rows, times are the
/// rows' own, and nothing reads the clock. The provider holds the idempotency
/// key to the first body it saw.
///
/// It is also the last look before a message goes. A message can wait —
/// behind a full day, or a provider that is down — and the invite it carries
/// can be withdrawn, or the reset used, in the meantime. Whatever the row now
/// says, the message follows: a link that no longer works is not sent.
/// </summary>
public sealed class EmailRenderer(
    FoxfireDbContext db,
    ActiveEmailProvider active,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
{
    public async Task<EmailRender> RenderAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        var now = time.GetUtcNow();
        var name = server.Value.Name;

        var content = message.Kind switch
        {
            EmailKinds.Invite => await InviteAsync(message, name, now, cancellationToken),
            EmailKinds.PasswordReset => await ResetAsync(message, name, now, cancellationToken),
            EmailKinds.Verification or EmailKinds.EmailChange => await ConfirmationAsync(message, name, now, cancellationToken),
            EmailKinds.PasswordChanged => await PasswordChangedAsync(message, name, cancellationToken),
            EmailKinds.Test => (EmailTemplates.Test(name, message.CreatedAt), null),
            _ => (null, "unknown_kind")
        };

        if (content is (null, var reason)) return new EmailRender.Drop(reason ?? "gone");

        var (body, _) = content;
        return new EmailRender.Ready(new OutboundEmail(
            message.Id,
            active.From,
            message.Recipient,
            message.Subject,
            body!.Html,
            body.Text,
            new Dictionary<string, string> { ["kind"] = message.Kind }));
    }

    private async Task<(EmailContent?, string?)> InviteAsync(
        EmailMessage message,
        string name,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var invite = await db.Invites.AsNoTracking().FirstOrDefaultAsync(i => i.Id == message.RelatedId, cancellationToken);

        if (invite is null) return (null, "gone");
        if (invite.RevokedAt is not null) return (null, "revoked");
        if (invite.RedeemedAt is not null) return (null, "used");
        if (invite.ExpiresAt <= now) return (null, "expired");
        if (!SameAddress(invite.Email, message.Recipient)) return (null, "stale");

        return (EmailTemplates.Invite(name, InviteLookup.LinkFor(invite, server.Value, auth.Value), invite.ExpiresAt), null);
    }

    private async Task<(EmailContent?, string?)> ResetAsync(
        EmailMessage message,
        string name,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var reset = await db.PasswordResets
            .AsNoTracking()
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == message.RelatedId, cancellationToken);

        if (reset?.User is not { } user) return (null, "gone");
        if (reset.RevokedAt is not null) return (null, "revoked");
        if (reset.RedeemedAt is not null) return (null, "used");
        if (reset.ExpiresAt <= now) return (null, "expired");
        if (PasswordResetLookup.IsDisabled(user, now)) return (null, "disabled");
        if (!string.Equals(user.SecurityStamp, reset.SecurityStamp, StringComparison.Ordinal)) return (null, "stale");

        // A link that takes the account over goes only to an address the
        // member has shown they read, and only the one the account has now.
        if (!user.EmailConfirmed) return (null, "unverified");
        if (!SameAddress(user.Email, message.Recipient)) return (null, "stale");

        return (EmailTemplates.PasswordReset(
            name,
            user.UserName ?? "",
            PasswordResetLookup.LinkFor(reset, server.Value, auth.Value),
            reset.ExpiresAt,
            PasswordResetLookup.IsSelfService(reset)), null);
    }

    private async Task<(EmailContent?, string?)> ConfirmationAsync(
        EmailMessage message,
        string name,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var verification = await db.EmailVerifications
            .AsNoTracking()
            .Include(v => v.User)
            .FirstOrDefaultAsync(v => v.Id == message.RelatedId, cancellationToken);

        if (verification?.User is not { } user) return (null, "gone");
        if (EmailVerificationLookup.Unusable(verification, user, now) is not null) return (null, "stale");
        if (!SameAddress(verification.Email, message.Recipient)) return (null, "stale");

        var link = EmailVerificationLookup.LinkFor(verification, server.Value, auth.Value);

        if (verification.Purpose == EmailVerificationPurposes.Verify)
        {
            if (user.EmailConfirmed) return (null, "already_confirmed");
            return (EmailTemplates.Verification(name, verification.Email, link, verification.ExpiresAt), null);
        }

        return (EmailTemplates.EmailChange(name, user.UserName ?? "", verification.Email, link, verification.ExpiresAt), null);
    }

    private async Task<(EmailContent?, string?)> PasswordChangedAsync(
        EmailMessage message,
        string name,
        CancellationToken cancellationToken)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == message.UserId, cancellationToken);

        if (user is null) return (null, "gone");
        if (!user.EmailConfirmed || !SameAddress(user.Email, message.Recipient)) return (null, "stale");

        var forgot = $"{server.Value.PublicUrl.TrimEnd('/')}/forgot-password";
        return (EmailTemplates.PasswordChanged(name, message.CreatedAt, forgot), null);
    }

    private static bool SameAddress(string? a, string? b) =>
        !string.IsNullOrWhiteSpace(a)
        && !string.IsNullOrWhiteSpace(b)
        && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}
