using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// Every League account this server tracks, not just the caller's.
///
/// Two things in one list, distinguished by IsMine rather than by being
/// separate endpoints: the accounts you may edit, and the accounts you may only
/// look at. The desktop needs both — one to write LP against, one to render
/// everybody else's games.
/// </summary>
public sealed record ListRiotAccountsRequest : IDomainRequest<IReadOnlyList<RiotAccountResponse>>;

internal sealed class ListRiotAccountsRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<ListRiotAccountsRequest, IReadOnlyList<RiotAccountResponse>>
{
    public async Task<Response<IReadOnlyList<RiotAccountResponse>>> Handle(
        ListRiotAccountsRequest request,
        CancellationToken cancellationToken)
    {
        var accounts = await db.RiotAccounts
            .Include(a => a.Owner)
            .OrderBy(a => a.GameName)
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<RiotAccountResponse>>.Success(
            [.. accounts.Select(a => RiotAccountResponse.Describe(a, me.UserId))]);
    }
}
