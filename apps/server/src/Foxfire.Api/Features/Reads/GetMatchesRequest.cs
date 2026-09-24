using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Reads;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Reads;

/// <summary>
/// A page of match history, and how many games there are under the same queue
/// filter.
///
/// The page size is capped rather than trusted. An uncapped limit is one typo
/// away from asking a shared server for somebody's entire history as a single
/// response, and nothing renders more than a page at a time anyway.
/// </summary>
public sealed record GetMatchesRequest(Guid RiotAccountId, int? Limit, int? Offset, int? QueueId)
    : IDomainRequest<Page<MatchSummaryResponse>>
{
    /// <summary>
    /// Smaller than the other lists' page: a match row carries six subqueries,
    /// and twenty is already more than a window shows.
    /// </summary>
    public const int DefaultLimit = 20;
}

internal sealed class GetMatchesRequestHandler(FoxfireDbContext db, MatchReads matches)
    : IDomainRequestHandler<GetMatchesRequest, Page<MatchSummaryResponse>>
{
    public async Task<Response<Page<MatchSummaryResponse>>> Handle(
        GetMatchesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<Page<MatchSummaryResponse>>.NotFound();

        var page = PageRequest.Of(request.Limit, request.Offset, GetMatchesRequest.DefaultLimit);
        var total = await matches.MatchCountAsync(account.Puuid, request.QueueId, cancellationToken);

        IReadOnlyList<MatchSummaryResponse> rows = page.Offset >= total
            ? []
            : await matches.MatchListAsync(
                account.Puuid,
                request.RiotAccountId,
                page.Limit,
                page.Offset,
                request.QueueId,
                cancellationToken: cancellationToken);

        return Response<Page<MatchSummaryResponse>>.Success(new Page<MatchSummaryResponse>(rows, total));
    }
}

/// <summary>
/// One game, as one player's row in their history: the same summary the list
/// shows, LP chip included.
///
/// For a link to a game somebody played. The full detail is the same for
/// everybody and comes from GetMatchDetailRequest; this is the part that
/// belongs to the player the link names.
/// </summary>
public sealed record GetMatchSummaryRequest(Guid RiotAccountId, string MatchId)
    : IDomainRequest<MatchSummaryResponse>;

internal sealed class GetMatchSummaryRequestHandler(FoxfireDbContext db, MatchReads matches)
    : IDomainRequestHandler<GetMatchSummaryRequest, MatchSummaryResponse>
{
    public async Task<Response<MatchSummaryResponse>> Handle(
        GetMatchSummaryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<MatchSummaryResponse>.NotFound();

        var rows = await matches.MatchListAsync(
            account.Puuid,
            request.RiotAccountId,
            limit: 1,
            offset: 0,
            queueId: null,
            matchId: request.MatchId,
            cancellationToken: cancellationToken);

        return rows.Count == 0 ? Response<MatchSummaryResponse>.NotFound() : rows[0];
    }
}

/// <summary>One game, in full. Not under an account: a match belongs to the server.</summary>
public sealed record GetMatchDetailRequest(string MatchId) : IDomainRequest<MatchDetailResponse>;

internal sealed class GetMatchDetailRequestHandler(MatchReads matches)
    : IDomainRequestHandler<GetMatchDetailRequest, MatchDetailResponse>
{
    public async Task<Response<MatchDetailResponse>> Handle(
        GetMatchDetailRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var detail = await matches.MatchDetailAsync(request.MatchId, cancellationToken);
        return detail is null ? Response<MatchDetailResponse>.NotFound() : detail;
    }
}

/// <summary>
/// The games a finished recording might be of.
///
/// Bounded by the caller's window rather than by the account's whole history: a
/// long-standing library is thousands of matches and the fingerprint only ever
/// looks at the last few hours. The bound is enforced anyway, because a window
/// nobody chose is a table scan somebody else on the server waits behind.
/// </summary>
public sealed record GetBindCandidatesRequest(Guid RiotAccountId, long SinceMs, long UntilMs)
    : IValidatedRequest<IReadOnlyList<BindCandidateResponse>>;

internal sealed class GetBindCandidatesRequestValidator : AbstractValidator<GetBindCandidatesRequest>
{
    /// <summary>
    /// Two weeks, which is well past the seven-day horizon the desktop stops
    /// retrying a recording at.
    /// </summary>
    private const long MaxWindowMs = 14L * 86_400_000L;

    public GetBindCandidatesRequestValidator() =>
        RuleFor(x => x)
            .Must(x => x.UntilMs > x.SinceMs && x.UntilMs - x.SinceMs <= MaxWindowMs)
            .WithErrorCode("window_too_wide")
            .WithMessage("Ask for a window of at most a fortnight.");
}

internal sealed class GetBindCandidatesRequestHandler(FoxfireDbContext db, MatchReads matches)
    : IValidatedRequestHandler<GetBindCandidatesRequest, IReadOnlyList<BindCandidateResponse>>
{
    public async Task<Response<IReadOnlyList<BindCandidateResponse>>> Handle(
        GetBindCandidatesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<IReadOnlyList<BindCandidateResponse>>.NotFound();

        return Response<IReadOnlyList<BindCandidateResponse>>.Success(
            await matches.BindCandidatesAsync(
                account.Puuid, request.SinceMs, request.UntilMs, cancellationToken));
    }
}
