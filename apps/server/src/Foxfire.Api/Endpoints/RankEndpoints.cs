using System.Security.Claims;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>A batch of hand-entered figures for one ladder.</summary>
public sealed record SaveManualRanksRequest(string QueueType, IReadOnlyList<ManualRankEditDto> Edits);

/// <summary>A season boundary, as an admin edits it.</summary>
public sealed record SeasonRequest(int? Id, string Label, long StartsAt, bool IsPreseason, bool ResetsRank);

/// <summary>
/// Rank: the graph, the milestones, the periods, and the figures somebody typed.
///
/// Reading is open to every member, like everything else here. Writing splits
/// two ways, and the split is the interesting part.
///
/// Typing LP for a game requires owning the account it was played on. It is an
/// assertion about what happened to somebody, and nobody else is in a position
/// to make it.
///
/// Editing a season is admin-only, and that is a stronger gate than it looks.
/// One wrong ResetsRank silently rewrites every member's LP history, because
/// attribution skips reset boundaries and is replayed from scratch — so a
/// mistaken boundary does not fail, it quietly produces different numbers for
/// everybody on the server.
/// </summary>
public static class RankEndpoints
{
    public static void MapRankEndpoints(this IEndpointRouteBuilder app)
    {
        var rank = app.MapGroup("/riot-accounts/{riotAccountId:guid}/rank")
            .WithTags("Rank")
            .RequireAuthorization();

        rank.MapGet("/history", HistoryAsync);
        rank.MapGet("/periods", PeriodsAsync);
        rank.MapGet("/editable", EditableAsync);
        rank.MapPost("/manual", SaveManualAsync);
        rank.MapDelete("/manual/{matchId}", ClearManualAsync);

        app.MapGet("/seasons", ListSeasonsAsync).WithTags("Rank").RequireAuthorization();

        app.MapPut("/seasons", SaveSeasonsAsync)
            .WithTags("Rank")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));
    }

    private static async Task<IResult> HistoryAsync(
        Guid riotAccountId,
        RankReads ranks,
        FoxfireDbContext db,
        CancellationToken cancellationToken,
        string queueType = "RANKED_SOLO_5x5",
        string? range = null)
    {
        if (!await db.RiotAccounts.AnyAsync(a => a.Id == riotAccountId, cancellationToken))
        {
            return Results.NotFound();
        }

        if (RankedQueues.FromRiotName(queueType) is null)
        {
            return AuthEndpoints.Problem("unknown_queue", $"{queueType} is not a ranked queue.");
        }

        return Results.Ok(await ranks.HistoryAsync(riotAccountId, queueType, range, cancellationToken));
    }

    private static async Task<IResult> PeriodsAsync(
        Guid riotAccountId,
        RankReads ranks,
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        var account = await db.RiotAccounts.AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken);

        if (account is null) return Results.NotFound();

        return Results.Ok(await ranks.PeriodsAsync(riotAccountId, account.Puuid, cancellationToken));
    }

    /// <summary>
    /// The games awaiting a figure.
    ///
    /// Gated on ownership even though it is a read, unlike everything else. It is
    /// the editor's list rather than a view of the history — offering somebody
    /// the games on an account they cannot write to would be offering them a form
    /// that cannot be submitted.
    /// </summary>
    private static async Task<IResult> EditableAsync(
        Guid riotAccountId,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        ManualRankEditor editor,
        CancellationToken cancellationToken,
        string queueType = "RANKED_SOLO_5x5")
    {
        var account = await Ownership.MineAsync(db, principal, riotAccountId, cancellationToken);
        if (account is null) return Ownership.NotYours();

        var queue = RankedQueues.FromRiotName(queueType);
        if (queue is null) return AuthEndpoints.Problem("unknown_queue", $"{queueType} is not a ranked queue.");

        return Results.Ok(await editor.EditableAsync(riotAccountId, account.Puuid, queue.Value, cancellationToken));
    }

    private static async Task<IResult> SaveManualAsync(
        Guid riotAccountId,
        [FromBody] SaveManualRanksRequest request,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        ManualRankEditor editor,
        IServerEvents events,
        CancellationToken cancellationToken)
    {
        var account = await Ownership.MineAsync(db, principal, riotAccountId, cancellationToken);
        if (account is null) return Ownership.NotYours();

        var queue = RankedQueues.FromRiotName(request.QueueType);
        if (queue is null)
        {
            return AuthEndpoints.Problem("unknown_queue", $"{request.QueueType} is not a ranked queue.");
        }

        // A tier that is not a tier is the one thing ManualRank cannot hold, so
        // it is refused here rather than inside the editor — and refused for
        // the batch, because a save that silently dropped the one edit it could
        // not read would look exactly like a save that worked.
        var edits = (request.Edits ?? []).Select(e => e.ToDomain()).ToList();
        if (edits.Exists(e => e is null)) return AuthEndpoints.Problem("invalid_rank", "Pick a tier");

        var problem = await editor.SaveAsync(
            riotAccountId,
            account.Puuid,
            queue.Value,
            [.. edits.Select(e => e!)],
            cancellationToken);

        if (problem is not null) return AuthEndpoints.Problem("invalid_rank", problem);

        // The window that has to react is usually not the one that called: the
        // LP editor is its own renderer with its own cache, and the match list
        // and rank graph it just changed are in the main window — here and on
        // everybody else's machine.
        await events.RankEditedAsync(riotAccountId, cancellationToken);

        return Results.NoContent();
    }

    private static async Task<IResult> ClearManualAsync(
        Guid riotAccountId,
        string matchId,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        ManualRankEditor editor,
        IServerEvents events,
        CancellationToken cancellationToken)
    {
        var account = await Ownership.MineAsync(db, principal, riotAccountId, cancellationToken);
        if (account is null) return Ownership.NotYours();

        var cleared = await editor.ClearAsync(riotAccountId, account.Puuid, matchId, cancellationToken);
        if (!cleared) return Results.NotFound();

        await events.RankEditedAsync(riotAccountId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ListSeasonsAsync(RankReads ranks, CancellationToken cancellationToken) =>
        Results.Ok((await ranks.SeasonsAsync(cancellationToken)).Select(RankReads.Describe));

    /// <summary>
    /// Replaces the whole season table, and then rebuilds everything derived from it.
    ///
    /// Whole rather than row-by-row because the boundaries are only meaningful as
    /// a series: a season runs until the next one starts, so inserting one
    /// changes the end of the one before it. Editing them as a list is also how
    /// the desktop's editor already works.
    ///
    /// The rebuild afterwards is not optional. Attribution skips reset boundaries
    /// and every stored LP figure was computed against the table as it stood, so
    /// leaving them alone would mean the graph and the season picker agreed with
    /// the new boundaries while the numbers on the match rows still described the
    /// old ones.
    /// </summary>
    private static async Task<IResult> SaveSeasonsAsync(
        [FromBody] IReadOnlyList<SeasonRequest> seasons,
        FoxfireDbContext db,
        AttributionRunner attribution,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        if (seasons is null || seasons.Count == 0)
        {
            return AuthEndpoints.Problem(
                "no_seasons",
                "A server needs at least one season, or nothing can tell a ladder reset from a bad night.");
        }

        var distinct = seasons.Select(s => s.StartsAt).Distinct().Count();
        if (distinct != seasons.Count)
        {
            return AuthEndpoints.Problem(
                "duplicate_boundary",
                "Two seasons cannot open at the same instant — the ordering is the whole of how a season is read.");
        }

        if (seasons.Any(s => string.IsNullOrWhiteSpace(s.Label)))
        {
            return AuthEndpoints.Problem("unnamed_season", "Every season needs a name.");
        }

        await db.Seasons.ExecuteDeleteAsync(cancellationToken);

        foreach (var season in seasons.OrderBy(s => s.StartsAt))
        {
            db.Seasons.Add(new RankedSeason
            {
                Label = season.Label.Trim(),
                StartsAt = season.StartsAt,
                IsPreseason = season.IsPreseason,
                ResetsRank = season.ResetsRank
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        // Every account, both ladders, unbounded. Expensive and rare — this runs
        // when somebody edits a boundary, which happens about once a year.
        var accounts = await db.RiotAccounts.AsNoTracking()
            .Select(a => new { a.Id, a.Puuid })
            .ToListAsync(cancellationToken);

        foreach (var account in accounts)
        {
            foreach (var queue in RankedQueues.All)
            {
                await attribution.RebuildAsync(account.Id, account.Puuid, queue, cancellationToken);
            }
        }

        logger.LogInformation(
            "An admin rewrote the season table ({Count} boundaries); LP was recomputed for {Accounts} account(s)",
            seasons.Count,
            accounts.Count);

        return Results.NoContent();
    }
}
