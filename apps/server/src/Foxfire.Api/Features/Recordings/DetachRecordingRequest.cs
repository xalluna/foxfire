using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Media;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// Takes a recording off a game — and off Foxfire Media — by the account's
/// owner or an admin.
///
/// Unlike uploading, an admin may: removing something from a community is the
/// kind of power an administrator is for, where claiming somebody's view of a
/// game is not. The video is deleted with it, because Foxfire Media holds it
/// for this server alone; nothing else could ever play it.
///
/// Foxfire Media first, then the row. One that does not answer leaves the row
/// where it is, so the removal can be asked again rather than leaving a video
/// nobody can find to delete.
/// </summary>
public sealed record DetachRecordingRequest(Guid RiotAccountId, string MatchId) : IEmptyDomainRequest;

internal sealed class DetachRecordingRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    AccountOwnership ownership,
    FoxfireMediaClient media,
    IServerEvents events,
    ILogger<DetachRecordingRequestHandler> logger)
    : IDomainRequestHandler<DetachRecordingRequest>
{
    public async Task<Response> Handle(DetachRecordingRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var mine = await ownership.MineAsync(request.RiotAccountId, cancellationToken) is not null;
        if (!mine && !me.IsInRole(FoxfireRoles.Admin))
        {
            return Response.Failure(
                new Error(
                    "not_yours",
                    "Only the owner of that League account, or an administrator, can remove its recording."),
                HttpStatusCode.Forbidden);
        }

        var row = await db.MatchRecordings
            .FirstOrDefaultAsync(
                r => r.MatchId == request.MatchId && r.RiotAccountId == request.RiotAccountId,
                cancellationToken);

        if (row is null) return Response.NotFound();

        var deleted = await media.DeleteVideoAsync(row.VideoId, cancellationToken);
        if (deleted != MediaOutcome.Ok)
        {
            return Response.Failure(
                new Error("media_unavailable", "The server's video storage is not answering, so the recording is still there. Try again shortly."),
                HttpStatusCode.ServiceUnavailable);
        }

        db.MatchRecordings.Remove(row);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Recording {VideoId} for {MatchId} on {RiotAccountId} removed by {UserId}",
            row.VideoId, request.MatchId, request.RiotAccountId, me.UserId);

        await events.RecordingChangedAsync(request.RiotAccountId, request.MatchId, cancellationToken);

        return Response.Success();
    }
}
