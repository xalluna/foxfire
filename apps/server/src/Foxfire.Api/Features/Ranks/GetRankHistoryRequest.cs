using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Reads;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Ranks;

/// <summary>One ladder's readings over a period, plus the crossings in it.</summary>
public sealed record GetRankHistoryRequest(Guid RiotAccountId, string QueueType, string? Range)
    : IValidatedRequest<RankHistoryResponse>;

internal sealed class GetRankHistoryRequestValidator : AbstractValidator<GetRankHistoryRequest>
{
    public GetRankHistoryRequestValidator() =>
        RuleFor(x => x.QueueType)
            .Must(queue => RankedQueues.FromRiotName(queue) is not null)
            .WithErrorCode("unknown_queue")
            .WithMessage(x => $"{x.QueueType} is not a ranked queue.");
}

internal sealed class GetRankHistoryRequestHandler(FoxfireDbContext db, RankReads ranks)
    : IValidatedRequestHandler<GetRankHistoryRequest, RankHistoryResponse>
{
    public async Task<Response<RankHistoryResponse>> Handle(
        GetRankHistoryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var known = await db.RiotAccounts.AnyAsync(a => a.Id == request.RiotAccountId, cancellationToken);
        if (!known) return Response<RankHistoryResponse>.NotFound();

        return await ranks.HistoryAsync(
            request.RiotAccountId, request.QueueType, request.Range, cancellationToken);
    }
}

/// <summary>The seasons this account has any history in, for the pickers.</summary>
public sealed record GetRankPeriodsRequest(Guid RiotAccountId)
    : IDomainRequest<IReadOnlyList<SeasonResponse>>;

internal sealed class GetRankPeriodsRequestHandler(FoxfireDbContext db, RankReads ranks)
    : IDomainRequestHandler<GetRankPeriodsRequest, IReadOnlyList<SeasonResponse>>
{
    public async Task<Response<IReadOnlyList<SeasonResponse>>> Handle(
        GetRankPeriodsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<IReadOnlyList<SeasonResponse>>.NotFound();

        return Response<IReadOnlyList<SeasonResponse>>.Success(
            await ranks.PeriodsAsync(request.RiotAccountId, account.Puuid, cancellationToken));
    }
}

/// <summary>Every recorded season boundary, oldest first.</summary>
public sealed record ListSeasonsRequest : IDomainRequest<IReadOnlyList<SeasonResponse>>;

internal sealed class ListSeasonsRequestHandler(RankReads ranks)
    : IDomainRequestHandler<ListSeasonsRequest, IReadOnlyList<SeasonResponse>>
{
    public async Task<Response<IReadOnlyList<SeasonResponse>>> Handle(
        ListSeasonsRequest request,
        CancellationToken cancellationToken) =>
        Response<IReadOnlyList<SeasonResponse>>.Success(
            [.. (await ranks.SeasonsAsync(cancellationToken)).Select(RankReads.Describe)]);
}
