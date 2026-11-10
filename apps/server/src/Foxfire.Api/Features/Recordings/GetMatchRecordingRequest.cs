using Foxfire.Api.Common;
using Foxfire.Api.Media;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// One account's recording of one game, with its markers.
///
/// Readable by every member, like everything else here. The pair is the whole
/// question: the same game asked for under a different account is a different
/// recording, or none, and never falls back to somebody else's.
///
/// A recording on its way — uploading, processing — is checked on with Foxfire
/// Media when this is read and the last check is old. Webhooks are what keep a
/// row current as it happens, but a Foxfire Media that cannot reach this
/// server's address (a homelab on another network, say) sends none, and a
/// desktop waiting to delete its copy reads this until the answer is "ready".
/// </summary>
public sealed record GetMatchRecordingRequest(Guid RiotAccountId, string MatchId)
    : IDomainRequest<MatchRecordingResponse>;

internal sealed class GetMatchRecordingRequestHandler(
    FoxfireDbContext db,
    FoxfireMediaClient media,
    IServerEvents events,
    TimeProvider time,
    ILogger<GetMatchRecordingRequestHandler> logger)
    : IDomainRequestHandler<GetMatchRecordingRequest, MatchRecordingResponse>
{
    /// <summary>How old a check may be before a read asks again.</summary>
    internal static readonly TimeSpan RecheckAfter = TimeSpan.FromSeconds(30);

    public async Task<Response<MatchRecordingResponse>> Handle(
        GetMatchRecordingRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var row = await db.MatchRecordings
            .Include(r => r.AttachedBy)
            .FirstOrDefaultAsync(
                r => r.MatchId == request.MatchId && r.RiotAccountId == request.RiotAccountId, cancellationToken);

        if (row is null) return Response<MatchRecordingResponse>.NotFound();

        var now = time.GetUtcNow();
        if (row.Status != RecordingStatuses.Ready && (row.CheckedAt is null || now - row.CheckedAt > RecheckAfter))
        {
            var before = row.Status;
            var video = await media.GetVideoAsync(row.VideoId, cancellationToken);

            if (video.Outcome == MediaOutcome.NotFound)
            {
                // Foxfire Media swept an upload that was never finished, or an
                // admin there deleted it. Either way there is nothing to play.
                db.MatchRecordings.Remove(row);
                await db.SaveChangesAsync(cancellationToken);
                logger.LogInformation(
                    "Recording {VideoId} for {MatchId} on {RiotAccountId} is gone from Foxfire Media, so its row went too",
                    row.VideoId, row.MatchId, row.RiotAccountId);
                await events.RecordingChangedAsync(row.RiotAccountId, row.MatchId, cancellationToken);
                return Response<MatchRecordingResponse>.NotFound();
            }

            if (video.IsOk)
            {
                Recordings.Apply(row, video.Value!, now);
                try
                {
                    await db.SaveChangesAsync(cancellationToken);
                }
                catch (DbUpdateConcurrencyException)
                {
                    // A webhook got there first, or the row was removed. What we
                    // read is still a fair answer for this request.
                }

                if (row.Status != before) await events.RecordingChangedAsync(row.RiotAccountId, row.MatchId, cancellationToken);
            }
        }

        return Recordings.ToResponse(row, row.AttachedBy?.UserName);
    }
}
