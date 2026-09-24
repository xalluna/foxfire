using Foxfire.Api.Common;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Api.Features.Sync;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Reads;

/// <summary>A Riot account's current standing on one ladder.</summary>
/// <param name="Rank">The division, under the name the desktop's renderer uses for it.</param>
public sealed record LeagueEntryResponse(
    string QueueType,
    string? Tier,
    string? Rank,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    DateTimeOffset FetchedAt)
{
    public static LeagueEntryResponse Describe(LeagueEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        return new LeagueEntryResponse(
            entry.QueueType,
            entry.Tier?.RiotName(),
            entry.Division?.RiotName(),
            entry.LeaguePoints,
            entry.Wins,
            entry.Losses,
            entry.FetchedAt);
    }
}

/// <summary>What the account page opens with.</summary>
public sealed record DashboardResponse(
    RiotAccountResponse Account,
    IReadOnlyList<LeagueEntryResponse> LeagueEntries,
    SyncStateResponse? SyncState,
    int StoredMatches);

/// <summary>The three things the account page opens with, in one round trip.</summary>
public sealed record GetDashboardRequest(Guid RiotAccountId) : IDomainRequest<DashboardResponse>;

internal sealed class GetDashboardRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    MatchReads matches,
    SyncService sync)
    : IDomainRequestHandler<GetDashboardRequest, DashboardResponse>
{
    public async Task<Response<DashboardResponse>> Handle(
        GetDashboardRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var id = request.RiotAccountId;

        var account = await db.RiotAccounts.AsNoTracking()
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

        if (account is null) return Response<DashboardResponse>.NotFound();

        var entries = await db.LeagueEntries.AsNoTracking()
            .Where(l => l.RiotAccountId == id)
            .OrderBy(l => l.QueueType)
            .ToListAsync(cancellationToken);

        var state = await db.SyncStates.AsNoTracking()
            .FirstOrDefaultAsync(s => s.RiotAccountId == id, cancellationToken);

        return new DashboardResponse(
            RiotAccountResponse.Describe(account, me.UserId),
            [.. entries.Select(LeagueEntryResponse.Describe)],
            state is null ? null : SyncStateResponse.Describe(state, sync.IsSyncing(id)),
            await matches.StoredMatchCountAsync(account.Puuid, cancellationToken));
    }
}
