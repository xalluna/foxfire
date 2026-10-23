using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Reads;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Ranks;

/// <summary>One ladder's readings over a period, plus the crossings in it.</summary>
/// <param name="Game">Whose ladders the queue type must name: League's on League's routes, TFT's on TFT's.</param>
public sealed record GetRankHistoryRequest(Guid RiotAccountId, string QueueType, string? Range, Game Game = Game.Lol)
    : IValidatedRequest<RankHistoryResponse>;

internal sealed class GetRankHistoryRequestValidator : AbstractValidator<GetRankHistoryRequest>
{
    public GetRankHistoryRequestValidator() =>
        RuleFor(x => x.QueueType)
            .Must((request, queue) => RankedQueues.FromRiotName(queue, request.Game) is not null)
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

/// <summary>The last thirty days of one ladder, a close a day, for the profile's graph.</summary>
public sealed record GetRankTrendRequest(Guid RiotAccountId, string QueueType, Game Game = Game.Lol)
    : IValidatedRequest<RankTrendResponse>;

internal sealed class GetRankTrendRequestValidator : AbstractValidator<GetRankTrendRequest>
{
    public GetRankTrendRequestValidator() =>
        RuleFor(x => x.QueueType)
            .Must((request, queue) => RankedQueues.FromRiotName(queue, request.Game) is not null)
            .WithErrorCode("unknown_queue")
            .WithMessage(x => $"{x.QueueType} is not a ranked queue.");
}

internal sealed class GetRankTrendRequestHandler(FoxfireDbContext db, RankReads ranks)
    : IValidatedRequestHandler<GetRankTrendRequest, RankTrendResponse>
{
    public async Task<Response<RankTrendResponse>> Handle(
        GetRankTrendRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var known = await db.RiotAccounts.AnyAsync(a => a.Id == request.RiotAccountId, cancellationToken);
        if (!known) return Response<RankTrendResponse>.NotFound();

        return await ranks.TrendAsync(request.RiotAccountId, request.QueueType, cancellationToken);
    }
}

/// <summary>The seasons this account has any history in, for the pickers.</summary>
public sealed record GetRankPeriodsRequest(Guid RiotAccountId, Game Game = Game.Lol)
    : IDomainRequest<IReadOnlyList<SeasonResponse>>;

internal sealed class GetRankPeriodsRequestHandler(FoxfireDbContext db, RankReads ranks, Foxfire.Api.Sync.TftIdentity tftIdentity)
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

        // An account never resolved under a TFT key of its own has no TFT games
        // here; its readings alone place it, under a puuid nothing is filed by.
        var puuid = request.Game == Game.Tft
            ? await tftIdentity.KnownPuuidAsync(account, cancellationToken) ?? string.Empty
            : account.Puuid;

        return Response<IReadOnlyList<SeasonResponse>>.Success(
            await ranks.PeriodsAsync(request.RiotAccountId, puuid, request.Game, cancellationToken));
    }
}

/// <summary>
/// One game's recorded season boundaries, oldest first — League's when the
/// request names no game, which is what a desktop from before TFT means.
/// </summary>
public sealed record ListSeasonsRequest(string? Game = null) : IValidatedRequest<IReadOnlyList<SeasonResponse>>;

internal sealed class ListSeasonsRequestValidator : AbstractValidator<ListSeasonsRequest>
{
    public ListSeasonsRequestValidator()
    {
        RuleFor(x => x.Game).MustNameAGame();
    }
}

internal sealed class ListSeasonsRequestHandler(RankReads ranks)
    : IValidatedRequestHandler<ListSeasonsRequest, IReadOnlyList<SeasonResponse>>
{
    public async Task<Response<IReadOnlyList<SeasonResponse>>> Handle(
        ListSeasonsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        return Response<IReadOnlyList<SeasonResponse>>.Success(
            [.. (await ranks.SeasonsAsync(GameParam.Parse(request.Game), cancellationToken)).Select(RankReads.Describe)]);
    }
}
