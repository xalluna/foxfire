using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Reads;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Api.Features.Sync;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Tft;

/// <summary>What the TFT profile opens with. See @foxfire/core's TftDashboard.</summary>
public sealed record TftDashboardResponse(
    RiotAccountResponse Account,
    IReadOnlyList<LeagueEntryResponse> LeagueEntries,
    SyncStateResponse? SyncState,
    IReadOnlyList<TftLadderSummaryResponse> Ladders,
    string? SeasonLabel,
    string TftAccess);

/// <summary>The TFT profile's header, its ladders' placements this set, and whether TFT can be fetched at all.</summary>
public sealed record GetTftDashboardRequest(Guid RiotAccountId) : IDomainRequest<TftDashboardResponse>;

internal sealed class GetTftDashboardRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    TftReads tft,
    SyncService sync,
    TftAccess access)
    : IDomainRequestHandler<GetTftDashboardRequest, TftDashboardResponse>
{
    public async Task<Response<TftDashboardResponse>> Handle(
        GetTftDashboardRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var id = request.RiotAccountId;

        var account = await db.RiotAccounts.AsNoTracking()
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

        if (account is null) return Response<TftDashboardResponse>.NotFound();

        var ladders = RankedQueues.Of(Game.Tft).Select(q => q.RiotName()).ToList();

        var entries = await db.LeagueEntries.AsNoTracking()
            .Where(l => l.RiotAccountId == id && ladders.Contains(l.QueueType))
            .ToListAsync(cancellationToken);

        var state = await db.SyncStates.AsNoTracking()
            .FirstOrDefaultAsync(s => s.RiotAccountId == id && s.Game == Game.Tft, cancellationToken);

        var (summaries, season) = await tft.LaddersAsync(await tft.PuuidAsync(account, cancellationToken), cancellationToken);

        return new TftDashboardResponse(
            RiotAccountResponse.Describe(account, me.UserId),
            [.. entries.OrderBy(e => ladders.IndexOf(e.QueueType)).Select(LeagueEntryResponse.Describe)],
            state is null ? null : SyncStateResponse.Describe(state, sync.IsSyncing(id, Game.Tft)),
            summaries,
            season,
            access.Slug);
    }
}

/// <summary>A page of one player's TFT history: twenty by default, never more than a hundred.</summary>
public sealed record GetTftMatchesRequest(Guid RiotAccountId, int? Limit, int? Offset, int? QueueId)
    : IDomainRequest<Page<TftMatchSummaryResponse>>
{
    public const int DefaultLimit = 20;
}

internal sealed class GetTftMatchesRequestHandler(FoxfireDbContext db, TftReads tft, IIdentityContext me)
    : IDomainRequestHandler<GetTftMatchesRequest, Page<TftMatchSummaryResponse>>
{
    public async Task<Response<Page<TftMatchSummaryResponse>>> Handle(
        GetTftMatchesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<Page<TftMatchSummaryResponse>>.NotFound();

        var page = PageRequest.Of(request.Limit, request.Offset, GetTftMatchesRequest.DefaultLimit);
        var puuid = await tft.PuuidAsync(account, cancellationToken);

        if (puuid is null) return new Page<TftMatchSummaryResponse>([], 0);

        var total = await tft.MatchCountAsync(puuid, request.QueueId, cancellationToken);

        IReadOnlyList<TftMatchSummaryResponse> rows = page.Offset >= total
            ? []
            : await tft.MatchListAsync(
                puuid, request.RiotAccountId, page.Limit, page.Offset, request.QueueId,
                cancellationToken: cancellationToken);

        return new Page<TftMatchSummaryResponse>(OutsiderView.For(me.UserId, rows), total);
    }
}

/// <summary>One TFT game, as one player's history row — what a link to it opens on.</summary>
public sealed record GetTftMatchSummaryRequest(Guid RiotAccountId, string MatchId)
    : IDomainRequest<TftMatchSummaryResponse>;

internal sealed class GetTftMatchSummaryRequestHandler(FoxfireDbContext db, TftReads tft, IIdentityContext me)
    : IDomainRequestHandler<GetTftMatchSummaryRequest, TftMatchSummaryResponse>
{
    public async Task<Response<TftMatchSummaryResponse>> Handle(
        GetTftMatchSummaryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<TftMatchSummaryResponse>.NotFound();

        var puuid = await tft.PuuidAsync(account, cancellationToken);
        if (puuid is null) return Response<TftMatchSummaryResponse>.NotFound();

        var rows = await tft.MatchListAsync(
            puuid, request.RiotAccountId, limit: 1, offset: 0, queueId: null, matchId: request.MatchId,
            cancellationToken: cancellationToken);

        return rows.Count == 0 ? Response<TftMatchSummaryResponse>.NotFound() : OutsiderView.For(me.UserId, rows)[0];
    }
}

/// <summary>Everybody's board in one TFT game.</summary>
public sealed record GetTftLobbyRequest(string MatchId) : IDomainRequest<TftLobbyResponse>;

internal sealed class GetTftLobbyRequestHandler(TftReads tft)
    : IDomainRequestHandler<GetTftLobbyRequest, TftLobbyResponse>
{
    public async Task<Response<TftLobbyResponse>> Handle(GetTftLobbyRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var lobby = await tft.LobbyAsync(request.MatchId, cancellationToken);
        return lobby is null ? Response<TftLobbyResponse>.NotFound() : lobby;
    }
}

/// <summary>The TFT games a recording made in a window might be of, at most a fortnight's.</summary>
public sealed record GetTftBindCandidatesRequest(Guid RiotAccountId, long SinceMs, long UntilMs)
    : IValidatedRequest<IReadOnlyList<TftBindCandidateResponse>>;

internal sealed class GetTftBindCandidatesRequestValidator : AbstractValidator<GetTftBindCandidatesRequest>
{
    private const long MaxWindowMs = 14L * 86_400_000L;

    public GetTftBindCandidatesRequestValidator() =>
        RuleFor(x => x)
            .Must(x => x.UntilMs > x.SinceMs && x.UntilMs - x.SinceMs <= MaxWindowMs)
            .WithErrorCode("window_too_wide")
            .WithMessage("Ask for a window of at most a fortnight.");
}

internal sealed class GetTftBindCandidatesRequestHandler(FoxfireDbContext db, TftReads tft)
    : IValidatedRequestHandler<GetTftBindCandidatesRequest, IReadOnlyList<TftBindCandidateResponse>>
{
    public async Task<Response<IReadOnlyList<TftBindCandidateResponse>>> Handle(
        GetTftBindCandidatesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == request.RiotAccountId, cancellationToken);

        if (account is null) return Response<IReadOnlyList<TftBindCandidateResponse>>.NotFound();

        var puuid = await tft.PuuidAsync(account, cancellationToken);
        if (puuid is null) return Response<IReadOnlyList<TftBindCandidateResponse>>.Success([]);

        return Response<IReadOnlyList<TftBindCandidateResponse>>.Success(
            await tft.BindCandidatesAsync(puuid, request.SinceMs, request.UntilMs, cancellationToken));
    }
}
