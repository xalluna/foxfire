using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// Takes a recording off a game, by the account's owner or an admin.
///
/// Unlike attaching, an admin may: removing something from a community is the
/// kind of power an administrator is for, where claiming somebody's view of a
/// game is not. Either way the video stays on YouTube — Foxfire can only
/// upload there, never delete — so this forgets the link and nothing more.
/// </summary>
public sealed record DetachRecordingRequest(Guid RiotAccountId, string MatchId) : IEmptyDomainRequest;

internal sealed class DetachRecordingRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    AccountOwnership ownership,
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

        db.MatchRecordings.Remove(row);
        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Recording for {MatchId} on {RiotAccountId} removed by {UserId}",
            request.MatchId, request.RiotAccountId, me.UserId);

        await events.RecordingChangedAsync(request.RiotAccountId, request.MatchId, cancellationToken);

        return Response.Success();
    }
}
