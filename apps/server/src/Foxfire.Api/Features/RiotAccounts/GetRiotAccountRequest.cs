using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// One League account, by the id this server gave it.
///
/// For whoever already knows which account they mean and has only the id to
/// show for it: the home a machine remembers, a recording window opened on
/// somebody's game, a page following a player whose Riot ID has just changed.
/// Anybody signed in may read any account — history on a server is everybody's.
/// </summary>
public sealed record GetRiotAccountRequest(Guid Id) : IDomainRequest<RiotAccountResponse>;

internal sealed class GetRiotAccountRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<GetRiotAccountRequest, RiotAccountResponse>
{
    public async Task<Response<RiotAccountResponse>> Handle(
        GetRiotAccountRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Id == request.Id, cancellationToken);

        return account is null
            ? Response<RiotAccountResponse>.NotFound()
            : Response<RiotAccountResponse>.Success(RiotAccountResponse.Describe(account, me.UserId));
    }
}
