using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Storage;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Replays;

/// <summary>
/// Removes a replay, by its uploader or an admin.
///
/// Not by anybody else, even though everybody can read it: one careless member
/// should not be able to empty a community's library. Anybody who played the
/// game can upload it again afterwards, which is what makes this recoverable
/// rather than destructive.
/// </summary>
public sealed record DeleteReplayRequest(string MatchId) : IEmptyDomainRequest;

internal sealed class DeleteReplayRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    IReplayStorage storage,
    ILogger<DeleteReplayRequestHandler> logger)
    : IDomainRequestHandler<DeleteReplayRequest>
{
    public async Task<Response> Handle(DeleteReplayRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var replay = await db.SharedReplays
            .FirstOrDefaultAsync(r => r.MatchId == request.MatchId, cancellationToken);

        if (replay is null) return Response.NotFound();

        if (replay.UploadedByUserId != me.UserId && !me.IsInRole(FoxfireRoles.Admin))
        {
            return Response.Failure(
                new Error(
                    "not_yours",
                    "Only whoever uploaded that replay, or an administrator, can remove it."),
                HttpStatusCode.Forbidden);
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
                logger.LogError(
                    ex, "Could not delete the blob for {MatchId}; removing the record anyway", request.MatchId);
            }
        }

        db.SharedReplays.Remove(replay);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Replay for {MatchId} removed by {UserId}", request.MatchId, me.UserId);

        return Response.Success();
    }
}
