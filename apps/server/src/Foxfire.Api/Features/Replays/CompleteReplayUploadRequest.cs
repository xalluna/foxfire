using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Storage;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Replays;

/// <summary>
/// Says the upload finished, and is not believed.
///
/// The server asks the store how big the blob is and records that number rather
/// than the one the desktop reported. An interrupted upload leaves a short
/// blob, and a short blob offered to somebody else is worse than no blob at all
/// — the failure would happen after they had waited for the download.
/// </summary>
public sealed record CompleteReplayUploadRequest(string MatchId) : IDomainRequest<SharedReplayResponse>;

internal sealed class CompleteReplayUploadRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    IReplayStorage storage,
    TimeProvider time,
    ILogger<CompleteReplayUploadRequestHandler> logger)
    : IDomainRequestHandler<CompleteReplayUploadRequest, SharedReplayResponse>
{
    private static Response<SharedReplayResponse> NotOffered() =>
        Response<SharedReplayResponse>.Failure(Replays.NotOffered, Replays.NotOfferedStatus);

    public async Task<Response<SharedReplayResponse>> Handle(
        CompleteReplayUploadRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!storage.IsConfigured) return NotOffered();

        var matchId = request.MatchId;

        // Including the uploader, who is the caller: this answer is a whole
        // SharedReplayResponse and the desktop renders the row from it. Without
        // the navigation loaded the name comes back null and the row somebody
        // just created is the one row on the screen with a blank where every
        // other one names who shared it.
        var replay = await db.SharedReplays
            .Include(r => r.UploadedBy)
            .FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);

        if (replay is null) return Response<SharedReplayResponse>.NotFound();

        if (replay.UploadedByUserId != me.UserId)
        {
            return Response<SharedReplayResponse>.Failure(
                new Error("not_your_claim", "That replay was claimed by somebody else."),
                HttpStatusCode.Forbidden);
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
            return Response<SharedReplayResponse>.Failure(
                new Error("upload_missing", "Nothing arrived in the blob store for that replay."),
                HttpStatusCode.Conflict);
        }

        replay.BlobKey = blobKey;
        replay.FileBytes = size;
        replay.UploadedAt = time.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Replay for {MatchId} uploaded ({Bytes} bytes)", matchId, size);

        return SharedReplayResponse.Describe(replay);
    }
}
