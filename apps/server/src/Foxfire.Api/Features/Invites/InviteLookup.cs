using Foxfire.Api.Configuration;
using Foxfire.Api.Email;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Invites;

/// <summary>An invite as an admin sees it.</summary>
/// <param name="Email">Who it was made for, when the admin gave an address.</param>
/// <param name="Link">
/// The whole point of the admin-facing shape. Without an email provider the
/// link is how an invite travels: the admin copies it and pastes it into
/// Discord, or wherever their community talks. With one, it is also what the
/// email to the invite's address carries.
/// </param>
/// <param name="Mail">What became of the email carrying it, when one was sent. Null when none was.</param>
/// <param name="CanEmail">
/// Whether an admin may email it now: the server sends mail, the invite is open
/// and has an address that has not been suppressed, and no email for it is on
/// its way or arrived. So after a failure, a soft bounce or a drop — or for an
/// invite made before the server had a provider — but never twice at once.
/// </param>
public sealed record InviteResponse(
    Guid Id,
    string? Email,
    string Link,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RedeemedAt,
    string? RedeemedBy,
    bool IsOpen,
    EmailDeliveryResponse? Mail = null,
    bool CanEmail = false);

/// <summary>
/// Turning a token back into the invite it names, and an invite into the shape
/// an admin reads.
///
/// Shared by every invite handler, which is why it is here rather than private
/// to one of them.
/// </summary>
internal static class InviteLookup
{
    /// <summary>
    /// Resolves a token to an invite, or to the reason there isn't one.
    ///
    /// A forged token and an unknown one give the same answer. Only a token that
    /// verified against this server's key is told anything more specific, and
    /// then only about its own state.
    /// </summary>
    public static async Task<(Invite? Invite, string Message)> ResolveAsync(
        string token,
        FoxfireDbContext db,
        AuthOptions auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var verified = InviteToken.Verify(token, auth.InviteSigningKeyBytes, now);

        switch (verified.Status)
        {
            case SignedTokenStatus.Expired:
                return (null, "This invite has expired. Ask whoever sent it for a new one.");
            case SignedTokenStatus.Malformed:
            case SignedTokenStatus.BadSignature:
                return (null, "This invite link is not valid for this server.");
            default:
                break;
        }

        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == verified.InviteId, cancellationToken);

        if (invite is null) return (null, "This invite link is not valid for this server.");
        if (invite.RedeemedAt is not null) return (null, "This invite has already been used.");
        if (invite.RevokedAt is not null) return (null, "This invite was withdrawn.");
        if (invite.ExpiresAt <= now) return (null, "This invite has expired. Ask whoever sent it for a new one.");

        return (invite, "Ready to use.");
    }

    public static InviteResponse Describe(
        Invite invite,
        ServerOptions server,
        AuthOptions auth,
        DateTimeOffset now)
    {
        return new InviteResponse(
            invite.Id,
            invite.Email,
            Link: LinkFor(invite, server, auth),
            invite.CreatedAt,
            invite.ExpiresAt,
            invite.RedeemedAt,
            invite.RedeemedBy?.UserName,
            invite.IsOpen(now));
    }

    /// <summary>
    /// Invites as <see cref="Describe"/> makes them, with what became of the mail
    /// about each — one query for the lot, and one for which addresses bounce.
    /// </summary>
    public static async Task<List<InviteResponse>> DescribeWithMailAsync(
        IReadOnlyList<Invite> invites,
        FoxfireDbContext db,
        bool mailEnabled,
        ServerOptions server,
        AuthOptions auth,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var latest = await EmailDeliveries.LatestAsync(
            db, EmailKinds.Invite, [.. invites.Where(i => i.Email is not null).Select(i => i.Id)], cancellationToken);

        var suppressed = mailEnabled
            ? await EmailDeliveries.SuppressedAsync(db, invites.Select(i => i.Email), cancellationToken)
            : [];

        return
        [
            .. invites.Select(invite =>
            {
                latest.TryGetValue(invite.Id, out var mail);

                var canEmail = mailEnabled
                    && invite.IsOpen(now)
                    && invite.Email is { } address
                    && !suppressed.Contains(EmailSuppression.Normalize(address))
                    && (mail is null || EmailDeliveries.EndedWithoutArriving(mail));

                return Describe(invite, server, auth, now) with
                {
                    Mail = mail is null ? null : EmailDeliveries.Describe(mail),
                    CanEmail = canEmail
                };
            })
        ];
    }

    /// <summary>
    /// The link an invite travels as. The same every time it is asked for — a
    /// signature over the row, not a value stored anywhere — so the one emailed
    /// is the one an admin copies.
    /// </summary>
    public static string LinkFor(Invite invite, ServerOptions server, AuthOptions auth)
    {
        var token = InviteToken.Issue(invite.Id, invite.ExpiresAt, auth.InviteSigningKeyBytes);
        return $"{server.PublicUrl.TrimEnd('/')}/invite/{token}";
    }
}
