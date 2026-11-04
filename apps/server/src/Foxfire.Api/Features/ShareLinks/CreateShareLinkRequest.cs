using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.ShareLinks;

/// <summary>
/// Shares one profile with somebody who is not a member.
///
/// Any member may share any profile: every member can already read every one,
/// and a link reads no more than they could — one account, for a week, with
/// nothing on it that says who on this server claimed it.
///
/// Sharing the same profile again within a day hands back the link made then,
/// rather than minting one per click. A member copying a link three times in an
/// evening means one link, and the admin list stays a list of people sharing
/// rather than of buttons pressed. After a day the link would be noticeably
/// shorter-lived than a fresh one, so a new one is made instead; the old one
/// keeps working until it lapses.
/// </summary>
public sealed record CreateShareLinkRequest(Guid RiotAccountId) : IDomainRequest<ShareLinkResponse>
{
    /// <summary>How recent a link must be to be handed back rather than replaced.</summary>
    public static readonly TimeSpan ReuseWithin = TimeSpan.FromDays(1);
}

internal sealed class CreateShareLinkRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<CreateShareLinkRequestHandler> logger)
    : IDomainRequestHandler<CreateShareLinkRequest, ShareLinkResponse>
{
    public async Task<Response<ShareLinkResponse>> Handle(
        CreateShareLinkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (me.UserId is not { } userId) return Response<ShareLinkResponse>.NotFound();

        var account = await db.RiotAccounts
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);
        if (account is null) return Response<ShareLinkResponse>.NotFound();

        var now = time.GetUtcNow();
        var recent = now - CreateShareLinkRequest.ReuseWithin;

        var existing = await db.ShareLinks
            .Include(s => s.RiotAccount)
            .Include(s => s.CreatedBy)
            .Where(ShareLink.OpenAt(now))
            .Where(s => s.RiotAccountId == account.Id && s.CreatedByUserId == userId && s.CreatedAt > recent)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (existing is not null) return ShareLinkLookup.Describe(existing, auth.Value);

        var link = new ShareLink
        {
            Id = Guid.CreateVersion7(now),
            RiotAccountId = account.Id,
            CreatedByUserId = userId,
            CreatedAt = now,
            ExpiresAt = now + auth.Value.ShareLinkLifetime
        };

        db.ShareLinks.Add(link);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "{Username} shared {RiotId}'s profile until {ExpiresAt}",
            me.Username,
            account.RiotId,
            link.ExpiresAt);

        await db.Entry(link).Reference(s => s.CreatedBy).LoadAsync(cancellationToken);
        return ShareLinkLookup.Describe(link, auth.Value);
    }
}
