using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>Current standing on one ladder.</summary>
/// <param name="Rank">The division, under the name the desktop's renderer uses for it.</param>
public sealed record LeagueEntryResponse(
    string QueueType,
    string? Tier,
    string? Rank,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    DateTimeOffset FetchedAt);

/// <summary>What the account page opens with.</summary>
public sealed record DashboardResponse(
    RiotAccountResponse Account,
    IReadOnlyList<LeagueEntryResponse> LeagueEntries,
    SyncStateResponse? SyncState,
    int StoredMatches);

/// <summary>Riot's lifetime mastery figure for one champion.</summary>
public sealed record MasteryEntryResponse(
    int ChampionId,
    int? ChampionPoints,
    int? ChampionLevel,
    long? LastPlayTime);

/// <summary>
/// Riot's mastery beside win rates worked out from stored games.
/// </summary>
/// <param name="LocalWinRates">
/// The only half that responds to a queue filter. Mastery is a single lifetime
/// figure with no per-queue breakdown, so it stays whole under any filter.
/// </param>
public sealed record MasteryResponse(
    IReadOnlyList<MasteryEntryResponse> RiotMastery,
    IReadOnlyList<ChampionStatsResponse> LocalWinRates);

/// <summary>
/// Reading what the server has: history, a game, champion numbers, mastery.
///
/// Every route here is open to any signed-in member, because everything on a
/// Foxfire server is. That is the decision the whole design rests on — match
/// history is shared, so a friend's games are as readable as your own, and the
/// screens that draw them need no idea whose account they are looking at.
///
/// Writes are elsewhere. Nothing on this file changes anything.
/// </summary>
public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        var accounts = app.MapGroup("/riot-accounts/{riotAccountId:guid}")
            .WithTags("Reads")
            .RequireAuthorization();

        accounts.MapGet("/dashboard", DashboardAsync);
        accounts.MapGet("/matches", MatchListAsync);
        accounts.MapGet("/champions", ChampionsAsync);
        accounts.MapGet("/mastery", MasteryAsync);

        // Not under an account: a match belongs to the server, and the detail
        // screen opens the same row whoever's history reached it.
        app.MapGet("/matches/{matchId}", MatchDetailAsync)
            .WithTags("Reads")
            .RequireAuthorization();
    }

    private static async Task<IResult> DashboardAsync(
        Guid riotAccountId,
        System.Security.Claims.ClaimsPrincipal principal,
        FoxfireDbContext db,
        MatchReads matches,
        SyncService sync,
        CancellationToken cancellationToken)
    {
        var account = await db.RiotAccounts.AsNoTracking()
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken);

        if (account is null) return Results.NotFound();

        var entries = await db.LeagueEntries.AsNoTracking()
            .Where(l => l.RiotAccountId == riotAccountId)
            .OrderBy(l => l.QueueType)
            .ToListAsync(cancellationToken);

        var state = await db.SyncStates.AsNoTracking()
            .FirstOrDefaultAsync(s => s.RiotAccountId == riotAccountId, cancellationToken);

        var me = Ownership.UserId(principal);

        return Results.Ok(new DashboardResponse(
            RiotLinkEndpoints.Describe(account, me),
            [.. entries.Select(Describe)],
            state is null
                ? null
                : new SyncStateResponse(
                    state.RiotAccountId,
                    state.MostRecentMatchId,
                    state.BackfillComplete,
                    state.BackfillTarget,
                    state.LastFullSyncAt,
                    state.LastDeltaSyncAt,
                    sync.IsSyncing(riotAccountId)),
            await matches.StoredMatchCountAsync(account.Puuid, cancellationToken)));
    }

    /// <summary>
    /// A page of match history.
    ///
    /// The page size is capped rather than trusted. An uncapped limit is one
    /// typo away from asking a shared server for somebody's entire history as a
    /// single response, and nothing renders more than a page at a time anyway.
    /// </summary>
    private static async Task<IResult> MatchListAsync(
        Guid riotAccountId,
        FoxfireDbContext db,
        MatchReads matches,
        CancellationToken cancellationToken,
        int limit = 20,
        int offset = 0,
        int? queueId = null)
    {
        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken);

        if (account is null) return Results.NotFound();

        return Results.Ok(await matches.MatchListAsync(
            account.Puuid,
            riotAccountId,
            Math.Clamp(limit, 1, 100),
            Math.Max(offset, 0),
            queueId,
            cancellationToken));
    }

    private static async Task<IResult> MatchDetailAsync(
        string matchId,
        MatchReads matches,
        CancellationToken cancellationToken)
    {
        var detail = await matches.MatchDetailAsync(matchId, cancellationToken);
        return detail is null ? Results.NotFound() : Results.Ok(detail);
    }

    private static async Task<IResult> ChampionsAsync(
        Guid riotAccountId,
        FoxfireDbContext db,
        MatchReads matches,
        RankReads ranks,
        TimeProvider time,
        CancellationToken cancellationToken,
        int? queueId = null,
        string? range = null)
    {
        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken);

        if (account is null) return Results.NotFound();

        var bounds = Foxfire.Core.RankedSeasons.RangeBounds(
            range,
            await ranks.SeasonsAsync(cancellationToken),
            time.GetUtcNow().ToUnixTimeMilliseconds());

        return Results.Ok(await matches.ChampionStatsAsync(
            account.Puuid, queueId, bounds.StartMs, bounds.EndMs, cancellationToken));
    }

    /// <summary>
    /// Mastery, fetched from Riot only when there is nothing stored or somebody
    /// asked for it.
    ///
    /// One Riot request per refresh, against a budget shared by everybody on the
    /// server, for a number that moves by a few hundred points a game. Caching it
    /// and refreshing on request is the whole of the policy — the desktop does
    /// the same, and there the budget was one person's.
    /// </summary>
    private static async Task<IResult> MasteryAsync(
        Guid riotAccountId,
        FoxfireDbContext db,
        MatchReads matches,
        RiotClient riot,
        TimeProvider time,
        CancellationToken cancellationToken,
        bool refresh = false,
        int? queueId = null)
    {
        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken);
        if (account is null) return Results.NotFound();

        var stored = await db.ChampionMasteries.AsNoTracking()
            .Where(m => m.RiotAccountId == riotAccountId)
            .OrderByDescending(m => m.ChampionPoints)
            .ToListAsync(cancellationToken);

        if (refresh || stored.Count == 0)
        {
            try
            {
                await RefreshMasteryAsync(db, riot, time, account, cancellationToken);

                stored = await db.ChampionMasteries.AsNoTracking()
                    .Where(m => m.RiotAccountId == riotAccountId)
                    .OrderByDescending(m => m.ChampionPoints)
                    .ToListAsync(cancellationToken);
            }
            catch (RiotApiException)
            {
                // Serving what is stored beats failing the screen. A rejected
                // key is the host's problem and the banner already says so; an
                // account that has never been fetched simply shows no mastery
                // beside win rates that are computed locally and still right.
            }
        }

        return Results.Ok(new MasteryResponse(
            [.. stored.Select(m => new MasteryEntryResponse(
                m.ChampionId, m.ChampionPoints, m.ChampionLevel, m.LastPlayTime))],
            await matches.ChampionStatsAsync(account.Puuid, queueId, null, null, cancellationToken)));
    }

    private static async Task RefreshMasteryAsync(
        FoxfireDbContext db,
        RiotClient riot,
        TimeProvider time,
        RiotAccount account,
        CancellationToken cancellationToken)
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

    private static LeagueEntryResponse Describe(LeagueEntry entry) =>
        new(entry.QueueType,
            entry.Tier,
            entry.Division,
            entry.LeaguePoints,
            entry.Wins,
            entry.Losses,
            entry.FetchedAt);
}
