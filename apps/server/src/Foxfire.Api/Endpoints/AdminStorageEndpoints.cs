using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Storage;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>What this server is holding, and where.</summary>
/// <param name="ReplaysConfigured">
/// False when no blob store is set up. Distinguished from an empty one, because
/// the two want different sentences in front of a host.
/// </param>
/// <param name="ReplayBytes">
/// As the store reports it, not as the rows claim. They should agree; when they
/// do not it is because a delete failed or an upload was abandoned, and the
/// store is the one that is right about disk.
/// </param>
public sealed record StorageUsageResponse(
    bool ReplaysConfigured,
    int ReplayCount,
    long ReplayBytes,
    int ReplayRecords,
    int Matches,
    int MatchParticipants,
    int RiotAccounts,
    int UnclaimedAccounts,
    int RankReadings);

/// <summary>What a shared replay looks like to whoever is deciding to delete it.</summary>
public sealed record AdminReplayResponse(
    string MatchId,
    string? Patch,
    long? FileBytes,
    string? UploadedBy,
    DateTimeOffset? UploadedAt);

/// <summary>
/// How much a community has accumulated.
///
/// Worth a page because self-hosting means somebody is paying for the disk,
/// literally or in a NAS they have to think about. The numbers that matter are
/// not symmetrical: SQL Server Express caps at 10 GB and a deduplicated match
/// history takes a long time to reach it, while replays are tens of megabytes
/// each and will be the thing that fills a volume.
///
/// Read-only except for removing a replay, which an admin can already do one at
/// a time through the ordinary route. There is no "delete all matches" here and
/// there should not be: it would be one click between a community and its
/// history, and the failure mode of a blob store filling up is a refused upload
/// rather than a broken server.
/// </summary>
public static class AdminStorageEndpoints
{
    public static void MapAdminStorageEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/storage")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", UsageAsync);
        admin.MapGet("/replays", ReplaysAsync);
    }

    private static async Task<IResult> UsageAsync(
        FoxfireDbContext db,
        IReplayStorage storage,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var usage = new StorageUsage(0, 0);

        if (storage.IsConfigured)
        {
            try
            {
                usage = await storage.UsageAsync(cancellationToken);
            }
            catch (ReplayStorageException ex)
            {
                // A store that will not answer is worth reporting and is not
                // worth failing the page over — every other number on it comes
                // from the database and is still true.
                logger.LogError(ex, "Could not read blob storage usage");
            }
        }

        return Results.Ok(new StorageUsageResponse(
            ReplaysConfigured: storage.IsConfigured,
            ReplayCount: usage.Count,
            ReplayBytes: usage.TotalBytes,
            ReplayRecords: await db.SharedReplays.CountAsync(r => r.UploadedAt != null, cancellationToken),
            Matches: await db.Matches.CountAsync(cancellationToken),
            MatchParticipants: await db.MatchParticipants.CountAsync(cancellationToken),
            RiotAccounts: await db.RiotAccounts.CountAsync(cancellationToken),
            UnclaimedAccounts: await db.RiotAccounts.CountAsync(a => a.OwnerId == null, cancellationToken),
            RankReadings: await db.RankSnapshots.CountAsync(cancellationToken)));
    }

    /// <summary>
    /// The library, biggest first.
    ///
    /// Biggest rather than newest, because the reason to open this list is that
    /// something needs to go. Capped, since a long-running community has
    /// thousands and nobody scrolls past the first screen looking for space.
    /// </summary>
    private static async Task<IResult> ReplaysAsync(
        FoxfireDbContext db,
        CancellationToken cancellationToken,
        int limit = 50)
    {
        var replays = await db.SharedReplays
            .AsNoTracking()
            .Include(r => r.UploadedBy)
            .Where(r => r.UploadedAt != null)
            .OrderByDescending(r => r.FileBytes)
            .Take(Math.Clamp(limit, 1, 200))
            .ToListAsync(cancellationToken);

        return Results.Ok(replays.Select(r => new AdminReplayResponse(
            r.MatchId, r.Patch, r.FileBytes, r.UploadedBy?.UserName, r.UploadedAt)));
    }
}
