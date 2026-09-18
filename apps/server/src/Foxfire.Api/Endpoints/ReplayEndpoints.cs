using System.Security.Claims;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Storage;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>What the desktop knows about a .rofl before it uploads one.</summary>
public sealed record ClaimReplayRequest(
    string MatchId,
    string? GameVersion,
    string? Patch,
    int? DurationSeconds,
    long FileBytes);

/// <summary>Permission to upload, and where to put it.</summary>
public sealed record ReplayUploadGrant(string MatchId, string UploadUrl, DateTimeOffset ExpiresAt);

/// <summary>A replay this server holds, as anybody on it sees one.</summary>
/// <param name="Patch">
/// What is needed to play it. Whether the person reading this has one is theirs
/// to know — the server says which, and the desktop checks its own installs.
/// </param>
public sealed record SharedReplayResponse(
    string MatchId,
    string? Patch,
    string? GameVersion,
    long? FileBytes,
    int? DurationSeconds,
    string? UploadedBy,
    DateTimeOffset? UploadedAt);

/// <summary>A download URL, good for a few minutes.</summary>
public sealed record ReplayDownloadGrant(string MatchId, string DownloadUrl, DateTimeOffset ExpiresAt);

/// <summary>
/// The shared replay library.
///
/// Riot produces one .rofl per game, identical for all ten players — the log is
/// of the game, not of a viewpoint — so one upload serves everybody who was in
/// it. That is the whole feature: a game somebody else played is watchable from
/// inside their own client, with every camera angle, for the cost of one upload
/// nobody had to coordinate.
///
/// No request here carries a replay. The desktop claims a match, gets a signed
/// URL, PUTs the bytes to the store directly, and says it finished; the server
/// then asks the store how big the blob actually is. A 30 MB file through a
/// homelab's API process would be somebody's upstream spent twice and a request
/// held open for the length of an upload, and the verification would be no
/// better — the desktop saying it worked is not evidence either way.
///
/// Claiming is first-come, and a claim expires. Two people finishing the same
/// game both have the file and both will offer it; one wins, the other is told
/// so and does nothing. If the winner's upload never lands, the claim goes stale
/// and the next offer takes it.
/// </summary>
public static class ReplayEndpoints
{
    /// <summary>
    /// How long an unfinished claim holds a match.
    ///
    /// Longer than any upload and shorter than the evening. A claim that never
    /// completed is somebody who closed their laptop mid-upload, and the game is
    /// still worth having from whoever else was in it.
    /// </summary>
    public static readonly TimeSpan ClaimLifetime = TimeSpan.FromMinutes(30);

    public static void MapReplayEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/replays").WithTags("Replays").RequireAuthorization();

        group.MapPost("/claim", ClaimAsync);
        group.MapPost("/{matchId}/complete", CompleteAsync);
        group.MapGet("/{matchId}", DescribeAsync);
        group.MapGet("/{matchId}/download", DownloadAsync);
        group.MapDelete("/{matchId}", DeleteAsync);
    }

    /// <summary>
    /// Asks for the right to upload one game's replay.
    ///
    /// Answers 409 when somebody else already holds it — which is the ordinary
    /// outcome for nine of the ten people in a game, and not a failure. The
    /// desktop treats it as "already covered" and moves on.
    /// </summary>
    private static async Task<IResult> ClaimAsync(
        [FromBody] ClaimReplayRequest request,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        IReplayStorage storage,
        TimeProvider time,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured) return NotOffered();

        var me = Ownership.UserId(principal);
        if (me is null) return Results.Unauthorized();

        var matchId = (request.MatchId ?? "").Trim();
        if (matchId.Length == 0)
        {
            return AuthEndpoints.Problem("invalid_match", "A replay has to name the game it is of.");
        }

        var now = time.GetUtcNow();
        var existing = await db.SharedReplays.FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);

        if (existing is not null)
        {
            if (existing.UploadedAt is not null)
            {
                return AuthEndpoints.Problem(
                    "already_uploaded",
                    "This server already has that replay.",
                    StatusCodes.Status409Conflict);
            }

            if (now - existing.ClaimedAt < ClaimLifetime && existing.UploadedByUserId != me)
            {
                return AuthEndpoints.Problem(
                    "claimed",
                    "Somebody else is uploading that replay.",
                    StatusCodes.Status409Conflict);
            }

            // Either it is this caller's own claim being retried, or the
            // previous one went stale. Both are taken over rather than refused.
            existing.UploadedByUserId = me;
            existing.ClaimedAt = now;
            existing.GameVersion = request.GameVersion;
            existing.Patch = request.Patch;
            existing.DurationSeconds = request.DurationSeconds;
        }
        else
        {
            db.SharedReplays.Add(new SharedReplay
            {
                MatchId = matchId,
                GameVersion = request.GameVersion,
                Patch = request.Patch,
                DurationSeconds = request.DurationSeconds,
                UploadedByUserId = me,
                ClaimedAt = now
            });
        }

        StorageGrant grant;
        try
        {
            grant = await storage.GrantUploadAsync(matchId, cancellationToken);
        }
        catch (ReplayStorageException ex)
        {
            logger.LogError(ex, "Could not mint an upload URL for {MatchId}", matchId);
            return NotOffered();
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two people claiming an unclaimed match at the same instant. The
            // primary key decides; the loser is told the truth.
            return AuthEndpoints.Problem(
                "claimed",
                "Somebody else just claimed that replay.",
                StatusCodes.Status409Conflict);
        }

        return Results.Ok(new ReplayUploadGrant(matchId, grant.Url.ToString(), grant.ExpiresAt));
    }

    /// <summary>
    /// Says the upload finished, and is not believed.
    ///
    /// The server asks the store how big the blob is and records that number
    /// rather than the one the desktop reported. An interrupted upload leaves a
    /// short blob, and a short blob offered to somebody else is worse than no
    /// blob at all — the failure would happen after they had waited for the
    /// download.
    /// </summary>
    private static async Task<IResult> CompleteAsync(
        string matchId,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        IReplayStorage storage,
        TimeProvider time,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured) return NotOffered();

        var me = Ownership.UserId(principal);
        var replay = await db.SharedReplays.FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);

        if (replay is null) return Results.NotFound();

        if (replay.UploadedByUserId != me)
        {
            return AuthEndpoints.Problem(
                "not_your_claim",
                "That replay was claimed by somebody else.",
                StatusCodes.Status403Forbidden);
        }

        var blobKey = AzureBlobReplayStorage.BlobKeyFor(matchId);
        long? size;

        try
        {
            size = await storage.SizeOfAsync(blobKey, cancellationToken);
        }
        catch (ReplayStorageException ex)
        {
            logger.LogError(ex, "Could not verify the upload for {MatchId}", matchId);
            return NotOffered();
        }

        if (size is null or 0)
        {
            return AuthEndpoints.Problem(
                "upload_missing",
                "Nothing arrived in the blob store for that replay.",
                StatusCodes.Status409Conflict);
        }

        replay.BlobKey = blobKey;
        replay.FileBytes = size;
        replay.UploadedAt = time.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Replay for {MatchId} uploaded ({Bytes} bytes)", matchId, size);

        return Results.Ok(Describe(replay));
    }

    private static async Task<IResult> DescribeAsync(
        string matchId,
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        var replay = await db.SharedReplays
            .AsNoTracking()
            .Include(r => r.UploadedBy)
            .FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);

        // A claim nobody finished is not a replay. Reporting one would offer a
        // download that cannot work.
        if (replay is null || !replay.IsAvailable) return Results.NotFound();

        return Results.Ok(Describe(replay));
    }

    /// <summary>
    /// A short-lived URL to fetch one.
    ///
    /// Open to every member, like everything else here: the games are shared, so
    /// the replays of them are. Minted per request rather than stored, because a
    /// URL that lives in a database is a credential that lives in a database.
    /// </summary>
    private static async Task<IResult> DownloadAsync(
        string matchId,
        FoxfireDbContext db,
        IReplayStorage storage,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        if (!storage.IsConfigured) return NotOffered();

        var replay = await db.SharedReplays
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);

        if (replay?.BlobKey is null || !replay.IsAvailable) return Results.NotFound();

        try
        {
            var grant = await storage.GrantDownloadAsync(replay.BlobKey, cancellationToken);
            return Results.Ok(new ReplayDownloadGrant(matchId, grant.Url.ToString(), grant.ExpiresAt));
        }
        catch (ReplayStorageException ex)
        {
            logger.LogError(ex, "Could not mint a download URL for {MatchId}", matchId);
            return NotOffered();
        }
    }

    /// <summary>
    /// Removes a replay, by its uploader or an admin.
    ///
    /// Not by anybody else, even though everybody can read it: one careless
    /// member should not be able to empty a community's library. Anybody who
    /// played the game can upload it again afterwards, which is what makes this
    /// recoverable rather than destructive.
    /// </summary>
    private static async Task<IResult> DeleteAsync(
        string matchId,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        IReplayStorage storage,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var replay = await db.SharedReplays.FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);
        if (replay is null) return Results.NotFound();

        var me = Ownership.UserId(principal);
        var isAdmin = principal.IsInRole(FoxfireRoles.Admin);

        if (replay.UploadedByUserId != me && !isAdmin)
        {
            return AuthEndpoints.Problem(
                "not_yours",
                "Only whoever uploaded that replay, or an administrator, can remove it.",
                StatusCodes.Status403Forbidden);
        }

        if (replay.BlobKey is not null && storage.IsConfigured)
        {
            try
            {
                await storage.DeleteAsync(replay.BlobKey, cancellationToken);
            }
            catch (ReplayStorageException ex)
            {
                // The row goes anyway. A blob the store will not delete is
                // wasted space an admin can clear by hand; a row pointing at a
                // blob nobody can fetch is a download that fails after a wait.
                logger.LogError(ex, "Could not delete the blob for {MatchId}; removing the record anyway", matchId);
            }
        }

        db.SharedReplays.Remove(replay);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Replay for {MatchId} removed by {UserId}", matchId, me);

        return Results.NoContent();
    }

    /// <summary>
    /// What a server with no blob store says.
    ///
    /// 503 rather than 404, and its own code: the difference between "this
    /// server does not do replays" and "it does and has not got that one" is the
    /// difference between hiding the affordance and showing it greyed out.
    /// </summary>
    private static IResult NotOffered() =>
        AuthEndpoints.Problem(
            "replays_unavailable",
            "This server is not set up to share replays.",
            StatusCodes.Status503ServiceUnavailable);

    private static SharedReplayResponse Describe(SharedReplay replay) =>
        new(replay.MatchId,
            replay.Patch,
            replay.GameVersion,
            replay.FileBytes,
            replay.DurationSeconds,
            replay.UploadedBy?.UserName,
            replay.UploadedAt);
}
