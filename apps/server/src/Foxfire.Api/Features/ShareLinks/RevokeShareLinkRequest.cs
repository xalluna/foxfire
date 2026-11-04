using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.ShareLinks;

/// <summary>
/// Withdraws a share link, by the member who made it or by an admin.
///
/// Kept rather than deleted, so somebody opening it afterwards is told it was
/// withdrawn rather than that it never existed. The next request made with it
/// is refused: a link is checked against its row on every request, not once.
/// </summary>
public sealed record RevokeShareLinkRequest(Guid Id) : IEmptyDomainRequest;

internal sealed class RevokeShareLinkRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    TimeProvider time,
    ILogger<RevokeShareLinkRequestHandler> logger)
    : IDomainRequestHandler<RevokeShareLinkRequest>
{
    public async Task<Response> Handle(RevokeShareLinkRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var link = await db.ShareLinks
            .Include(s => s.RiotAccount)
            .FirstOrDefaultAsync(s => s.Id == request.Id, cancellationToken);
        if (link is null) return Response.NotFound();

        if (link.CreatedByUserId != me.UserId && !me.IsInRole(FoxfireRoles.Admin))
        {
            return Response.Failure(
                new Error("not_your_share_link", "Only whoever shared this link, or an admin, can withdraw it."),
                HttpStatusCode.Forbidden);
        }

        if (link.RevokedAt is null)
        {
            link.RevokedAt = time.GetUtcNow();
            await db.SaveChangesAsync(cancellationToken);

            logger.LogInformation(
                "{Username} withdrew share link {ShareLinkId} to {RiotId}'s profile",
                me.Username,
                link.Id,
                link.RiotAccount?.RiotId);
        }

        return Response.Success();
    }
}
