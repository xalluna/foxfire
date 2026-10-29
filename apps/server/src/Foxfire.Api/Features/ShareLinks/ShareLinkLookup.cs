using Foxfire.Api.Configuration;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.ShareLinks;

/// <summary>A share link, as the member who made it and the admins see it.</summary>
/// <param name="Token">
/// What makes it a link: the client puts it on the profile's address as
/// <c>?share=</c>. Recomputed from the row each time, never stored, so copying
/// it again tomorrow gives the same link.
/// </param>
/// <param name="CreatedBy">Who shared it.</param>
public sealed record ShareLinkResponse(
    Guid Id,
    Guid RiotAccountId,
    string GameName,
    string TagLine,
    string Token,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    string? CreatedBy);

/// <summary>
/// Why a share link let nobody in: a reason a client tells apart, and the
/// sentence a person following it is shown.
/// </summary>
/// <param name="Reason">"expired", "withdrawn", "invalid" — or "not_shared", a link that works but not here.</param>
public sealed record ShareRefusal(string Reason, string Message)
{
    /// <summary>The error code a refused read answers with.</summary>
    public string Code => Reason == NotShared.Reason ? Reason : $"share_link_{Reason}";

    public static ShareRefusal Expired { get; } =
        new("expired", "This link has expired. Ask whoever sent it for a new one.");

    public static ShareRefusal Withdrawn { get; } =
        new("withdrawn", "This link was withdrawn. Ask whoever sent it for a new one.");

    /// <summary>The same answer for a forged token and an unknown one, as an invite's.</summary>
    public static ShareRefusal Invalid { get; } = new("invalid", "This link is not valid for this server.");

    /// <summary>A link that still works, asked for something it does not open.</summary>
    public static ShareRefusal NotShared { get; } =
        new("not_shared", "The link you were given opens one profile, and this is another.");
}

/// <summary>
/// Turning a token back into the link it names, and a link into the shape a
/// member reads. Shared by every share-link handler and by the reader policy.
/// </summary>
internal static class ShareLinkLookup
{
    /// <summary>
    /// Resolves a token to an open link — its account loaded — or to the
    /// reason there isn't one.
    /// </summary>
    public static async Task<(ShareLink? Link, ShareRefusal? Refusal)> ResolveAsync(
        string token,
        FoxfireDbContext db,
        AuthOptions auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var verified = ShareToken.Verify(token, auth.InviteSigningKeyBytes, now);

        switch (verified.Status)
        {
            case SignedTokenStatus.Expired:
                return (null, ShareRefusal.Expired);
            case SignedTokenStatus.Malformed:
            case SignedTokenStatus.BadSignature:
                return (null, ShareRefusal.Invalid);
            default:
                break;
        }

        var link = await db.ShareLinks
            .AsNoTracking()
            .Include(s => s.RiotAccount)
            .FirstOrDefaultAsync(s => s.Id == verified.ShareLinkId, cancellationToken);

        if (link?.RiotAccount is null) return (null, ShareRefusal.Invalid);
        if (link.RevokedAt is not null) return (null, ShareRefusal.Withdrawn);
        if (link.ExpiresAt <= now) return (null, ShareRefusal.Expired);

        return (link, null);
    }

    /// <summary>A link with its account and creator loaded, as its member or an admin sees it.</summary>
    public static ShareLinkResponse Describe(ShareLink link, AuthOptions auth)
    {
        ArgumentNullException.ThrowIfNull(link);
        ArgumentNullException.ThrowIfNull(link.RiotAccount);

        return new ShareLinkResponse(
            link.Id,
            link.RiotAccountId,
            link.RiotAccount.GameName,
            link.RiotAccount.TagLine,
            Token: ShareToken.Issue(link.Id, link.ExpiresAt, auth.InviteSigningKeyBytes),
            link.CreatedAt,
            link.ExpiresAt,
            link.CreatedBy?.UserName);
    }
}
