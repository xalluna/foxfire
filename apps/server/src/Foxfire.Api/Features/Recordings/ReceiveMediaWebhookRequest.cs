using System.Net;
using System.Text.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Media;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// Foxfire Media telling the server what became of a video: started, uploaded,
/// processing, ready, failed, deleted.
///
/// Nothing is believed until the signature checks out against the application
/// key only Foxfire Media and this server hold. After that, each event moves its
/// row forward — never back (<see cref="RecordingStatuses.Rank"/>): a delivery
/// retried late cannot undo the one that followed it. A video this server has no
/// row for is not an error; the row may have been removed first.
/// </summary>
public sealed record ReceiveMediaWebhookRequest(string? Signature, byte[] Body) : IEmptyDomainRequest;

internal sealed class ReceiveMediaWebhookRequestHandler(
    FoxfireDbContext db,
    IOptions<MediaOptions> options,
    IServerEvents events,
    TimeProvider time,
    ILogger<ReceiveMediaWebhookRequestHandler> logger)
    : IDomainRequestHandler<ReceiveMediaWebhookRequest>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record Envelope(string? Id, string? Type, MediaVideoEvent? Data);

    private sealed record MediaVideoEvent(string? VideoId, string? Status, long? DurationMs, string? Error);

    public async Task<Response> Handle(ReceiveMediaWebhookRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var now = time.GetUtcNow();
        if (!MediaSignature.Verify(request.Signature, request.Body, options.Value.ApiKey, now))
        {
            logger.LogWarning("Refused a webhook claiming to be from Foxfire Media: its signature does not check out");
            return Response.Failure(
                new Error("invalid_signature", "That webhook's signature does not check out."),
                HttpStatusCode.Unauthorized);
        }

        Envelope? envelope;
        try
        {
            envelope = JsonSerializer.Deserialize<Envelope>(request.Body, Json);
        }
        catch (JsonException)
        {
            envelope = null;
        }

        if (envelope?.Data?.VideoId is not { } videoId) return Response.Success();

        var row = await db.MatchRecordings.FirstOrDefaultAsync(r => r.VideoId == videoId, cancellationToken);
        if (row is null)
        {
            logger.LogDebug("Foxfire Media sent {Type} for {VideoId}, which this server has no recording of", envelope.Type, videoId);
            return Response.Success();
        }

        if (envelope.Type == "video.deleted")
        {
            db.MatchRecordings.Remove(row);
            await db.SaveChangesAsync(cancellationToken);
            logger.LogInformation(
                "Recording {VideoId} for {MatchId} on {RiotAccountId} was deleted on Foxfire Media", videoId, row.MatchId, row.RiotAccountId);
            await events.RecordingChangedAsync(row.RiotAccountId, row.MatchId, cancellationToken);
            return Response.Success();
        }

        var status = RecordingStatuses.FromMedia(envelope.Data.Status);
        if (RecordingStatuses.Rank(status) < RecordingStatuses.Rank(row.Status)) return Response.Success();

        var changed = status != row.Status;
        row.Status = status;
        row.Error = status is RecordingStatuses.Failed or RecordingStatuses.UploadFailed ? Recordings.Clip(envelope.Data.Error) : null;
        if (envelope.Data.DurationMs is { } ms) row.DurationSeconds = (int)Math.Round(ms / 1000.0);
        if (status == RecordingStatuses.Ready) row.ReadyAt ??= now;
        row.CheckedAt = now;
        await db.SaveChangesAsync(cancellationToken);

        if (changed)
        {
            if (status is RecordingStatuses.Failed or RecordingStatuses.UploadFailed)
            {
                logger.LogWarning("Recording {VideoId} for {MatchId} is {Status} on Foxfire Media: {Error}", videoId, row.MatchId, status, row.Error);
            }
            else
            {
                logger.LogInformation("Recording {VideoId} for {MatchId} is {Status}", videoId, row.MatchId, status);
            }

            await events.RecordingChangedAsync(row.RiotAccountId, row.MatchId, cancellationToken);
        }

        return Response.Success();
    }
}
