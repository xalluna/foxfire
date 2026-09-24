using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>
/// Every invite that can still be used, newest first.
///
/// Whole rather than paged, because it cannot grow: an invite stops being open
/// the moment it is used or withdrawn, and on its own after
/// <see cref="AuthOptions.InviteLifetime"/>. Revoked and expired invites are
/// not sent at all — nothing draws them, and they are the part of the table
/// that only ever grows. The used ones are <see cref="ListUsedInvitesRequest"/>.
/// </summary>
public sealed record ListOpenInvitesRequest : IDomainRequest<IReadOnlyList<InviteResponse>>;

internal sealed class ListOpenInvitesRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<ListOpenInvitesRequest, IReadOnlyList<InviteResponse>>
{
    public async Task<Response<IReadOnlyList<InviteResponse>>> Handle(
        ListOpenInvitesRequest request,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();

        var invites = await db.Invites
            .AsNoTracking()
            .Where(Invite.OpenAt(now))
            .OrderByDescending(i => i.CreatedAt)
            .ThenBy(i => i.Id)
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<InviteResponse>>.Success(
            [.. invites.Select(i => InviteLookup.Describe(i, server.Value, auth.Value, now))]);
    }
}
