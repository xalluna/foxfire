using Foxfire.Api.Common;
using Foxfire.Api.Reads;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Reads;

/// <summary>Per-champion performance over a period, worked out from stored games.</summary>
public sealed record GetChampionStatsRequest(Guid RiotAccountId, int? QueueId, string? Range)
    : IDomainRequest<IReadOnlyList<ChampionStatsResponse>>;

internal sealed class GetChampionStatsRequestHandler(
    FoxfireDbContext db,
    MatchReads matches,
    RankReads ranks,
    TimeProvider time)
    : IDomainRequestHandler<GetChampionStatsRequest, IReadOnlyList<ChampionStatsResponse>>
{
    public async Task<Response<IReadOnlyList<ChampionStatsResponse>>> Handle(
        GetChampionStatsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<IReadOnlyList<ChampionStatsResponse>>.NotFound();

        var bounds = RankedSeasons.RangeBounds(
            request.Range,
            await ranks.SeasonsAsync(cancellationToken),
            time.GetUtcNow().ToUnixTimeMilliseconds());

        return Response<IReadOnlyList<ChampionStatsResponse>>.Success(
            await matches.ChampionStatsAsync(
                account.Puuid, request.QueueId, bounds.StartMs, bounds.EndMs, cancellationToken));
    }
}
