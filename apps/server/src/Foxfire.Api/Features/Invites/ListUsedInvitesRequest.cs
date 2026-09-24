using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>
/// The invites somebody registered with, most recently used first, a page at a
/// time.
///
/// This is the half of the invite table that grows for as long as a server
/// runs — one row for everybody who ever joined by invitation — so it is paged
/// where the open ones (<see cref="ListOpenInvitesRequest"/>) are not. It used
/// to be the newest two hundred of everything, and anything older simply was
/// not there.
/// </summary>
public sealed record ListUsedInvitesRequest(int? Limit = null, int? Offset = null)
    : IDomainRequest<Page<InviteResponse>>;

internal sealed class ListUsedInvitesRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<ListUsedInvitesRequest, Page<InviteResponse>>
{
    public async Task<Response<Page<InviteResponse>>> Handle(
        ListUsedInvitesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var now = time.GetUtcNow();

        var invites = await db.Invites
            .AsNoTracking()
            .Include(i => i.RedeemedBy)
            .Where(i => i.RedeemedAt != null)
            .OrderByDescending(i => i.RedeemedAt)
            .ThenBy(i => i.Id)
            .ToPageAsync(PageRequest.Of(request.Limit, request.Offset), cancellationToken);

        return Response<Page<InviteResponse>>.Success(
            invites.Map(i => InviteLookup.Describe(i, server.Value, auth.Value, now)));
    }
}
