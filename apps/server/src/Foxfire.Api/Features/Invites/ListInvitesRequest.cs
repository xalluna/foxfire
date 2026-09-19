using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>Every invite this server has issued, newest first.</summary>
public sealed record ListInvitesRequest : IDomainRequest<IReadOnlyList<InviteResponse>>;

internal sealed class ListInvitesRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<ListInvitesRequest, IReadOnlyList<InviteResponse>>
{
    public async Task<Response<IReadOnlyList<InviteResponse>>> Handle(
        ListInvitesRequest request,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();

        var invites = await db.Invites
            .Include(i => i.RedeemedBy)
            .OrderByDescending(i => i.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<InviteResponse>>.Success(
            [.. invites.Select(i => InviteLookup.Describe(i, server.Value, auth.Value, now))]);
    }
}
