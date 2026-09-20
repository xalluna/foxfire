using Foxfire.Api.Configuration;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Invites;

/// <summary>An invite as an admin sees it.</summary>
/// <param name="Link">
/// The whole point of the admin-facing shape. SMTP is optional here, so every
/// link the server would have emailed is also readable and copyable — a host
/// with no working mail pastes it into Discord instead.
/// </param>
public sealed record InviteResponse(
    Guid Id,
    string Email,
    string Link,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RedeemedAt,
    string? RedeemedBy,
    bool IsOpen);

/// <summary>
/// Turning a token back into the invite it names, and an invite into the shape
/// an admin reads.
///
/// Shared by four handlers, which is why it is here rather than private to one
/// of them.
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
            case InviteTokenStatus.Expired:
                return (null, "This invite has expired. Ask whoever sent it for a new one.");
            case InviteTokenStatus.Malformed:
            case InviteTokenStatus.BadSignature:
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
        var token = InviteToken.Issue(invite.Id, invite.ExpiresAt, auth.InviteSigningKeyBytes);

        return new InviteResponse(
            invite.Id,
            invite.Email,
            Link: $"{server.PublicUrl.TrimEnd('/')}/invite/{token}",
            invite.CreatedAt,
            invite.ExpiresAt,
            invite.RedeemedAt,
            invite.RedeemedBy?.UserName,
            invite.IsOpen(now));
    }
}
