using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.ShareLinks;

/// <summary>
/// Every share link that still opens something, newest first, a page at a time.
///
/// Paged although every link lapses within a week, because any member may
/// share, and so how many are open at once grows with the community rather
/// than with the admins. Invites, which only admins make, can stay a list.
/// </summary>
public sealed record ListShareLinksRequest(int? Limit = null, int? Offset = null)
    : IDomainRequest<Page<ShareLinkResponse>>;

internal sealed class ListShareLinksRequestHandler(
    FoxfireDbContext db,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<ListShareLinksRequest, Page<ShareLinkResponse>>
{
    public async Task<Response<Page<ShareLinkResponse>>> Handle(
        ListShareLinksRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var links = await db.ShareLinks
            .AsNoTracking()
            .Include(s => s.RiotAccount)
            .Include(s => s.CreatedBy)
            .Where(ShareLink.OpenAt(time.GetUtcNow()))
            .OrderByDescending(s => s.CreatedAt)
            .ThenBy(s => s.Id)
            .ToPageAsync(PageRequest.Of(request.Limit, request.Offset), cancellationToken);

        return Response<Page<ShareLinkResponse>>.Success(
            links.Map(link => ShareLinkLookup.Describe(link, auth.Value)));
    }
}
