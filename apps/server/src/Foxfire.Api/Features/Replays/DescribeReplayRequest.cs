using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Storage;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Replays;

/// <summary>Whether this server holds one, and what it needs to play.</summary>
public sealed record DescribeReplayRequest(string MatchId) : IDomainRequest<SharedReplayResponse>;

internal sealed class DescribeReplayRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<DescribeReplayRequest, SharedReplayResponse>
{
    public async Task<Response<SharedReplayResponse>> Handle(
        DescribeReplayRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var replay = await db.SharedReplays
            .AsNoTracking()
            .Include(r => r.UploadedBy)
            .FirstOrDefaultAsync(r => r.MatchId == request.MatchId, cancellationToken);

        // A claim nobody finished is not a replay. Reporting one would offer a
        // download that cannot work.
        if (replay is null || !replay.IsAvailable) return Response<SharedReplayResponse>.NotFound();

        return SharedReplayResponse.Describe(replay);
    }
}

/// <summary>A download URL, good for a few minutes.</summary>
public sealed record ReplayDownloadGrant(string MatchId, string DownloadUrl, DateTimeOffset ExpiresAt);

/// <summary>
/// A short-lived URL to fetch one.
///
/// Open to every member, like everything else here: the games are shared, so
/// the replays of them are. Minted per request rather than stored, because a
/// URL that lives in a database is a credential that lives in a database.
/// </summary>
public sealed record GrantReplayDownloadRequest(string MatchId) : IDomainRequest<ReplayDownloadGrant>;

internal sealed class GrantReplayDownloadRequestHandler(
    FoxfireDbContext db,
    IReplayStorage storage,
    ILogger<GrantReplayDownloadRequestHandler> logger)
    : IDomainRequestHandler<GrantReplayDownloadRequest, ReplayDownloadGrant>
{
    public async Task<Response<ReplayDownloadGrant>> Handle(
        GrantReplayDownloadRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!storage.IsConfigured)
        {
            return Response<ReplayDownloadGrant>.Failure(Replays.NotOffered, Replays.NotOfferedStatus);
        }

        var replay = await db.SharedReplays
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.MatchId == request.MatchId, cancellationToken);

        if (replay?.BlobKey is null || !replay.IsAvailable) return Response<ReplayDownloadGrant>.NotFound();

        try
        {
            var grant = await storage.GrantDownloadAsync(replay.BlobKey, cancellationToken);
            return new ReplayDownloadGrant(request.MatchId, grant.Url.ToString(), grant.ExpiresAt);
        }
        catch (ReplayStorageException ex)
        {
            logger.LogError(ex, "Could not mint a download URL for {MatchId}", request.MatchId);
            return Response<ReplayDownloadGrant>.Failure(Replays.NotOffered, Replays.NotOfferedStatus);
        }
    }
}
