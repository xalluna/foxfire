using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// The League accounts the caller has claimed.
///
/// What a desktop keeps to hand: the rail, the accounts it syncs at launch, the
/// ones the League client watcher writes LP against. Its size is how many
/// accounts one person plays on, whatever the size of the community, which is
/// why this is a list and the rest of the server is a lookup or a page.
/// </summary>
public sealed record ListMyRiotAccountsRequest : IDomainRequest<IReadOnlyList<RiotAccountResponse>>;

internal sealed class ListMyRiotAccountsRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<ListMyRiotAccountsRequest, IReadOnlyList<RiotAccountResponse>>
{
    public async Task<Response<IReadOnlyList<RiotAccountResponse>>> Handle(
        ListMyRiotAccountsRequest request,
        CancellationToken cancellationToken)
    {
        // Nobody signed in owns nothing. Asked rather than compared, because a
        // null compared against OwnerId would be every unclaimed account.
        if (me.UserId is not { } userId) return Response<IReadOnlyList<RiotAccountResponse>>.Success([]);

        var accounts = await db.RiotAccounts
            .Include(a => a.Owner)
            .Where(a => a.OwnerId == userId)
            .OrderBy(a => a.GameName)
            .ThenBy(a => a.TagLine)
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<RiotAccountResponse>>.Success(
            [.. accounts.Select(a => RiotAccountResponse.Describe(a, userId))]);
    }
}
