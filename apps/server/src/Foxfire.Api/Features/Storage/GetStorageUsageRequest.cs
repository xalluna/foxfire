using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Storage;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Storage;

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

/// <summary>How much a community has accumulated.</summary>
public sealed record GetStorageUsageRequest : IDomainRequest<StorageUsageResponse>;

internal sealed class GetStorageUsageRequestHandler(
    FoxfireDbContext db,
    IReplayStorage storage,
    ILogger<GetStorageUsageRequestHandler> logger)
    : IDomainRequestHandler<GetStorageUsageRequest, StorageUsageResponse>
{
    public async Task<Response<StorageUsageResponse>> Handle(
        GetStorageUsageRequest request,
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

        return new StorageUsageResponse(
            ReplaysConfigured: storage.IsConfigured,
            ReplayCount: usage.Count,
            ReplayBytes: usage.TotalBytes,
            ReplayRecords: await db.SharedReplays.CountAsync(r => r.UploadedAt != null, cancellationToken),
            Matches: await db.Matches.CountAsync(cancellationToken),
            MatchParticipants: await db.MatchParticipants.CountAsync(cancellationToken),
            RiotAccounts: await db.RiotAccounts.CountAsync(cancellationToken),
            UnclaimedAccounts: await db.RiotAccounts.CountAsync(a => a.OwnerId == null, cancellationToken),
            RankReadings: await db.RankSnapshots.CountAsync(cancellationToken));
    }
}
