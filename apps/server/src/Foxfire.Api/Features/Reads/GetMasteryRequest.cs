using Foxfire.Api.Common;
using Foxfire.Api.Reads;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Reads;

/// <summary>Riot's lifetime mastery figure for one champion.</summary>
public sealed record MasteryEntryResponse(
    int ChampionId,
    int? ChampionPoints,
    int? ChampionLevel,
    long? LastPlayTime);

/// <summary>Riot's mastery beside win rates worked out from stored games.</summary>
/// <param name="LocalWinRates">
/// The only half that responds to a queue filter. Mastery is a single lifetime
/// figure with no per-queue breakdown, so it stays whole under any filter.
/// </param>
public sealed record MasteryResponse(
    IReadOnlyList<MasteryEntryResponse> RiotMastery,
    IReadOnlyList<ChampionStatsResponse> LocalWinRates);

/// <summary>
/// Mastery, fetched from Riot only when there is nothing stored or somebody
/// asked for it.
///
/// One Riot request per refresh, against a budget shared by everybody on the
/// server, for a number that moves by a few hundred points a game. Caching it
/// and refreshing on request is the whole of the policy — the desktop does the
/// same, and there the budget was one person's.
/// </summary>
public sealed record GetMasteryRequest(Guid RiotAccountId, bool Refresh, int? QueueId)
    : IDomainRequest<MasteryResponse>;

internal sealed class GetMasteryRequestHandler(
    FoxfireDbContext db,
    MatchReads matches,
    RiotClient riot,
    TimeProvider time)
    : IDomainRequestHandler<GetMasteryRequest, MasteryResponse>
{
    public async Task<Response<MasteryResponse>> Handle(
        GetMasteryRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var id = request.RiotAccountId;

        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == id, cancellationToken);
        if (account is null) return Response<MasteryResponse>.NotFound();

        var stored = await StoredAsync(id, cancellationToken);

        if (request.Refresh || stored.Count == 0)
        {
            try
            {
                await RefreshAsync(account, cancellationToken);
                stored = await StoredAsync(id, cancellationToken);
            }
            catch (RiotApiException)
            {
                // Serving what is stored beats failing the screen. A rejected
                // key is the host's problem and the banner already says so; an
                // account that has never been fetched simply shows no mastery
                // beside win rates that are computed locally and still right.
            }
        }

        return new MasteryResponse(
            [.. stored.Select(m => new MasteryEntryResponse(
                m.ChampionId, m.ChampionPoints, m.ChampionLevel, m.LastPlayTime))],
            await matches.ChampionStatsAsync(account.Puuid, request.QueueId, null, null, cancellationToken));
    }

    private Task<List<ChampionMastery>> StoredAsync(Guid riotAccountId, CancellationToken cancellationToken) =>
        db.ChampionMasteries.AsNoTracking()
            .Where(m => m.RiotAccountId == riotAccountId)
            .OrderByDescending(m => m.ChampionPoints)
            .ToListAsync(cancellationToken);

    private async Task RefreshAsync(RiotAccount account, CancellationToken cancellationToken)
    {
        var fresh = await riot.GetChampionMasteryAsync(
            account.Platform, account.Puuid, RiotRequestPriority.Interactive, cancellationToken);

        var now = time.GetUtcNow();

        var existing = await db.ChampionMasteries
            .Where(m => m.RiotAccountId == account.Id)
            .ToDictionaryAsync(m => m.ChampionId, cancellationToken);

        foreach (var entry in fresh)
        {
            if (existing.TryGetValue(entry.ChampionId, out var row))
            {
                row.ChampionPoints = entry.ChampionPoints;
                row.ChampionLevel = entry.ChampionLevel;
                row.LastPlayTime = entry.LastPlayTime;
                row.FetchedAt = now;
            }
            else
            {
                db.ChampionMasteries.Add(new ChampionMastery
                {
                    RiotAccountId = account.Id,
                    ChampionId = entry.ChampionId,
                    ChampionPoints = entry.ChampionPoints,
                    ChampionLevel = entry.ChampionLevel,
                    LastPlayTime = entry.LastPlayTime,
                    FetchedAt = now
                });
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
