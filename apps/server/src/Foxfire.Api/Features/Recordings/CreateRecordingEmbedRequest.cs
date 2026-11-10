using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Media;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// A page that plays one recording, for a member who has opened it.
///
/// Members only, as the recording routes all are: outsiders — an open
/// server's visitors, a share link — are never given a recording. The page is
/// Foxfire Media's, with its own controls hidden (<c>controls=0</c>), because
/// Foxfire draws its own over it and drives it through Foxfire Media's control
/// API. Foxfire Media only lets it be framed by, and talk to, the origins its
/// application lists, which is this server's own.
/// </summary>
public sealed record CreateRecordingEmbedRequest(Guid RiotAccountId, string MatchId)
    : IDomainRequest<RecordingEmbedResponse>;

internal sealed class CreateRecordingEmbedRequestHandler(FoxfireDbContext db, FoxfireMediaClient media)
    : IDomainRequestHandler<CreateRecordingEmbedRequest, RecordingEmbedResponse>
{
    public async Task<Response<RecordingEmbedResponse>> Handle(
        CreateRecordingEmbedRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var row = await db.MatchRecordings
            .AsNoTracking()
            .FirstOrDefaultAsync(
                r => r.MatchId == request.MatchId && r.RiotAccountId == request.RiotAccountId, cancellationToken);

        if (row is null) return Response<RecordingEmbedResponse>.NotFound();

        if (row.Status != RecordingStatuses.Ready)
        {
            return Response<RecordingEmbedResponse>.Failure(
                new Error("not_ready", "This recording is not ready to watch yet."),
                HttpStatusCode.Conflict);
        }

        var embed = await media.CreateEmbedAsync(row.VideoId, cancellationToken);
        if (!embed.IsOk)
        {
            return StartRecordingUploadRequestHandler.MediaFailure<RecordingEmbedResponse>(embed.Outcome, embed.Message);
        }

        return new RecordingEmbedResponse(
            RecordingEmbeds.WithoutControls(embed.Value!.EmbedUrl), embed.Value.PosterUrl, embed.Value.ExpiresAt);
    }
}

/// <summary>Foxfire Media's player with only the video showing, for a client that draws its own controls.</summary>
public static class RecordingEmbeds
{
    public static string WithoutControls(string embedUrl) =>
        embedUrl + (embedUrl.Contains('?', StringComparison.Ordinal) ? "&" : "?") + "controls=0";
}
