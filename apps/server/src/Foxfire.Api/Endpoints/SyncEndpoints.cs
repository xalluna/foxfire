using System.Security.Claims;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>A game just ended on the machine that sent this.</summary>
public sealed record GameEndedRequest(Guid RiotAccountId);

/// <summary>
/// A rank reading the desktop took from a running League client.
///
/// <paramref name="Force"/> is what makes a game that moved no LP still count:
/// without a reading either side of it, the game before and the game after share
/// one interval and neither can be attributed.
/// </summary>
public sealed record RankReadingRequest(
    Guid RiotAccountId,
    string QueueType,
    string? Tier,
    string? Division,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    bool Force);

/// <summary>
/// Whether the reading was actually filed.
///
/// Said out loud rather than left as a status code, because the desktop acts
/// on it: a forced reading that was written is what clears the watcher's
/// wait for a post-game value to settle, and one that was not means the
/// client is still serving the rank the player went in with.
/// </summary>
public sealed record RankReadingResponse(bool Recorded);

/// <summary>How far through fetching an account's history the server has got.</summary>
public sealed record SyncStateResponse(
    // Named for what the desktop calls it rather than for the column it came
    // from. This is the shape its SyncState type consumes, and a field it spells
    // differently is a field it silently reads as undefined.
    Guid AccountId,
    string? MostRecentMatchId,
    bool BackfillComplete,
    int BackfillTarget,
    DateTimeOffset? LastFullSyncAt,
    DateTimeOffset? LastDeltaSyncAt,
    bool IsSyncing);

/// <summary>
/// Asking the server to go and fetch, and telling it when to.
///
/// The desktop drove its own sync because it was the only thing that existed.
/// Here it signals and the server decides: the League client watcher notices a
/// game ended and posts that fact, and the retry ladder that follows belongs to
/// the server because it has to outlive the laptop closing and must not run
/// twice when two people were in the same game.
///
/// Every write is gated on owning the Riot account. Reads are not, because
/// everything on this server is readable by every member — but a sync spends the
/// community's Riot budget, and a rank reading claims to have seen somebody's
/// client, so neither is a thing to accept from just anybody who is logged in.
/// </summary>
public static class SyncEndpoints
{
    public static void MapSyncEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/sync").WithTags("Sync").RequireAuthorization();

        group.MapPost("/{riotAccountId:guid}", StartAsync);
        group.MapGet("/{riotAccountId:guid}", ReadStateAsync);
        group.MapPost("/game-ended", GameEndedAsync);

        app.MapPost("/rank-readings", RecordRankAsync)
            .WithTags("Sync")
            .RequireAuthorization();
    }

    /// <summary>
    /// Starts a sync and answers immediately.
    ///
    /// 202 rather than waiting: a first backfill is two hundred Riot requests
    /// through a queue shared with everybody, which is minutes. Progress arrives
    /// over the hub, and the run finishes whether or not the caller is still
    /// listening.
    /// </summary>
    private static async Task<IResult> StartAsync(
        Guid riotAccountId,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        SyncService sync,
        CancellationToken cancellationToken)
    {
        var account = await OwnedAsync(db, principal, riotAccountId, cancellationToken);
        if (account is null) return NotYours();

        // Deliberately not awaited. The result is delivered as progress events,
        // and a failed run has already reported itself as one.
        _ = sync.SyncAsync(riotAccountId, SyncTrigger.Manual, CancellationToken.None);

        return Results.Accepted($"/sync/{riotAccountId}");
    }

    /// <summary>
    /// The end-of-game signal, from the desktop that saw it.
    ///
    /// Answers accepted even when a ladder is already running for the account:
    /// the later game's schedule replaces the earlier one, and a delta sync
    /// fetches everything new, so the first game is found by the second game's
    /// attempts anyway.
    /// </summary>
    private static async Task<IResult> GameEndedAsync(
        [FromBody] GameEndedRequest request,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        PostGameSyncScheduler scheduler,
        CancellationToken cancellationToken)
    {
        var account = await OwnedAsync(db, principal, request.RiotAccountId, cancellationToken);
        if (account is null) return NotYours();

        scheduler.Schedule(request.RiotAccountId);
        return Results.Accepted();
    }

    private static async Task<IResult> ReadStateAsync(
        Guid riotAccountId,
        FoxfireDbContext db,
        SyncService sync,
        CancellationToken cancellationToken)
    {
        // Readable by any member, like everything else here: the progress bar on
        // somebody else's account is not a secret, and hiding it would make a
        // shared history look broken while it filled in.
        var state = await db.SyncStates
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.RiotAccountId == riotAccountId, cancellationToken);

        if (state is null)
        {
            var known = await db.RiotAccounts.AnyAsync(a => a.Id == riotAccountId, cancellationToken);
            if (!known) return Results.NotFound();

            // Linked but never synced. A null row and a zeroed one say the same
            // thing to the desktop, and the zeroed one saves it a special case.
            return Results.Ok(new SyncStateResponse(
                riotAccountId, null, false, 0, null, null, sync.IsSyncing(riotAccountId)));
        }

        return Results.Ok(new SyncStateResponse(
            state.RiotAccountId,
            state.MostRecentMatchId,
            state.BackfillComplete,
            state.BackfillTarget,
            state.LastFullSyncAt,
            state.LastDeltaSyncAt,
            sync.IsSyncing(riotAccountId)));
    }

    /// <summary>
    /// Files a reading the League client reported, and attributes what it closes.
    ///
    /// The attribution afterwards is a fast path, not the guarantee: it lands
    /// only when the game is already stored, which for a game that just ended it
    /// usually is not. What actually closes the interval is the replay at the end
    /// of the sync the post-game ladder is about to run.
    /// </summary>
    private static async Task<IResult> RecordRankAsync(
        [FromBody] RankReadingRequest request,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        RankRecorder ranks,
        AttributionRunner attribution,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var account = await OwnedAsync(db, principal, request.RiotAccountId, cancellationToken);
        if (account is null) return NotYours();

        if (RankedQueues.FromRiotName(request.QueueType) is null)
        {
            return AuthEndpoints.Problem(
                "unknown_queue",
                $"{request.QueueType} is not a ranked queue this server tracks.");
        }

        var wrote = await ranks.RecordAsync(
            account.Id,
            new RankReadingInput(
                request.QueueType,
                request.Tier,
                request.Division,
                request.LeaguePoints,
                request.Wins,
                request.Losses),
            RankSources.Lcu,
            time.GetUtcNow().ToUnixTimeMilliseconds(),
            request.Force,
            cancellationToken);

        if (!wrote) return Results.Ok(new RankReadingResponse(false));

        await db.SaveChangesAsync(cancellationToken);

        var since = time.GetUtcNow().ToUnixTimeMilliseconds() - AttributionRunner.ReplayWindowMs;
        await attribution.ReplayAsync(account.Id, account.Puuid, since, cancellationToken);

        return Results.Ok(new RankReadingResponse(true));
    }

    private static Task<RiotAccount?> OwnedAsync(
        FoxfireDbContext db,
        ClaimsPrincipal principal,
        Guid riotAccountId,
        CancellationToken cancellationToken) =>
        Ownership.MineAsync(db, principal, riotAccountId, cancellationToken);

    private static IResult NotYours() => Ownership.NotYours();
}
