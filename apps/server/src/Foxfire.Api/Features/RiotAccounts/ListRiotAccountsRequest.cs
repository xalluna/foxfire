using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// Every League account this server tracks, in one answer. Only Desktop 0.14 asks.
///
/// This was how every client learned about accounts: the whole table, with
/// IsMine telling the caller's apart, held in memory and searched there for
/// whichever one a page named. That is a number that grows with the community
/// rather than with the person asking, and a server with a large one would hand
/// every desktop all of it on every launch. Clients from Server 0.4.0 ask for
/// what they need instead — their own accounts, one account by id or Riot ID,
/// and a page of search.
///
/// Kept, unchanged, because Desktop 0.14.0 is on the allow list and reads
/// nothing else. Delete it in the PR that takes 0.14.x off Allowed.
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
