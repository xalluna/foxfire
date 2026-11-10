using System.Globalization;
using System.Net;
using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Media;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>What starting an upload sends. See RecordingUploadInput on the TypeScript side.</summary>
public sealed record StartRecordingUploadBody(
    string? Title,
    string? Filename,
    long SizeBytes,
    int? DurationSeconds,
    IReadOnlyList<RecordingEventDto>? Events,
    bool Replace = false);

public sealed record StartRecordingUploadRequest(Guid RiotAccountId, string MatchId, StartRecordingUploadBody Body)
    : IValidatedRequest<RecordingUploadResponse>;

internal sealed class StartRecordingUploadRequestValidator : AbstractValidator<StartRecordingUploadRequest>
{
    public StartRecordingUploadRequestValidator()
    {
        RuleFor(x => x.Body.Title)
            .Must(title => !string.IsNullOrWhiteSpace(title) && title.Trim().Length <= Recordings.MaxTitleLength)
            .WithErrorCode("invalid_title")
            .WithMessage($"A recording needs a title of at most {Recordings.MaxTitleLength} characters.");

        RuleFor(x => x.Body.Filename)
            .Must(name => !string.IsNullOrWhiteSpace(name) && name.Length <= 255)
            .WithErrorCode("invalid_filename")
            .WithMessage("A recording needs its file's name, which says what kind of video it is.");

        RuleFor(x => x.Body.SizeBytes)
            .GreaterThan(0)
            .WithErrorCode("invalid_size")
            .WithMessage("That is not the size of a video.");

        RuleFor(x => x.Body.DurationSeconds)
            .InclusiveBetween(0, (int)Recordings.MaxSeconds)
            .When(x => x.Body.DurationSeconds is not null)
            .WithErrorCode("invalid_duration")
            .WithMessage("That is not a length a game can be.");

        RuleFor(x => x.Body.Events)
            .Must(events => events is null || (events.Count <= Recordings.MaxEvents && events.All(Recordings.IsReasonable)))
            .WithErrorCode("invalid_events")
            .WithMessage("The recording's markers were not ones a game produces.");
    }
}

/// <summary>
/// Starts — or picks back up — the upload of one account's view of one game, as its owner.
///
/// What comes back is a ticket for Foxfire Media, not a place on this server:
/// the desktop sends the file straight there, so a member's 500 GB of
/// recordings never pass through, or sit in the memory of, the server that
/// lent them a token. This server only says who may upload what.
///
/// Owner only, and admins included in the refusal — the same rule as a rank
/// reading, and for the same reason: "this video is my screen in that game" is
/// a claim about somebody's account that nobody but its owner can make.
///
/// Asking again is how an upload carries on. A recording still waiting for its
/// file, or whose upload stopped, gets a fresh token for the same video. One
/// that is already there is a 409 unless the caller asked somebody and was
/// told to replace it.
/// </summary>
internal sealed class StartRecordingUploadRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    AccountOwnership ownership,
    RecordingAccess access,
    FoxfireMediaClient media,
    IServerEvents events,
    TimeProvider time,
    ILogger<StartRecordingUploadRequestHandler> logger)
    : IValidatedRequestHandler<StartRecordingUploadRequest, RecordingUploadResponse>
{
    public async Task<Response<RecordingUploadResponse>> Handle(
        StartRecordingUploadRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (me.UserId is not { } userId)
        {
            return Response<RecordingUploadResponse>.Failure(
                new Error("unauthenticated", "Sign in again."), HttpStatusCode.Unauthorized);
        }

        var account = await ownership.MineAsync(request.RiotAccountId, cancellationToken);
        if (account is null)
        {
            return Response<RecordingUploadResponse>.Failure(AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);
        }

        if (!await access.PlayedAsync(account, request.MatchId, cancellationToken))
        {
            return Response<RecordingUploadResponse>.Failure(RecordingAccess.NotInMatch, HttpStatusCode.NotFound);
        }

        var body = request.Body;
        var now = time.GetUtcNow();
        var row = await db.MatchRecordings
            .FirstOrDefaultAsync(r => r.MatchId == request.MatchId && r.RiotAccountId == account.Id, cancellationToken);

        MediaResult<MediaUploadTicket> ticket;
        string externalId;

        if (row is not null && row.Status is RecordingStatuses.Uploading or RecordingStatuses.UploadFailed)
        {
            // The same video, again: a token for it, which also tells Foxfire
            // Media the size of the file now on its way.
            externalId = row.ExternalId;
            ticket = await media.RenewUploadAsync(row.VideoId, body.SizeBytes, cancellationToken);

            if (ticket.Outcome == MediaOutcome.Conflict)
            {
                return await RefusedAsInFlightAsync(row, now, cancellationToken);
            }

            if (ticket.Outcome == MediaOutcome.NotFound)
            {
                // Foxfire Media swept an upload that never finished. Start a new one.
                externalId = Replacement(account.Id, request.MatchId, now);
                ticket = await media.CreateUploadAsync(
                    body.Title!.Trim(), body.Filename!, body.SizeBytes, externalId, null, cancellationToken);
            }
        }
        else if (row is not null && !body.Replace)
        {
            return Exists(row);
        }
        else if (row is not null)
        {
            var deleted = await media.DeleteVideoAsync(row.VideoId, cancellationToken);
            if (deleted != MediaOutcome.Ok) return MediaFailure<RecordingUploadResponse>(deleted, null);

            logger.LogInformation(
                "Recording {VideoId} for {MatchId} on {RiotAccountId} is being replaced by {UserId}",
                row.VideoId, row.MatchId, account.Id, userId);

            externalId = Replacement(account.Id, request.MatchId, now);
            ticket = await media.CreateUploadAsync(
                body.Title!.Trim(), body.Filename!, body.SizeBytes, externalId, null, cancellationToken);
        }
        else
        {
            externalId = Recordings.ExternalId(request.MatchId, account.Id);
            ticket = await media.CreateUploadAsync(
                body.Title!.Trim(), body.Filename!, body.SizeBytes, externalId, null, cancellationToken);

            if (ticket.Outcome == MediaOutcome.Conflict)
            {
                // A first upload whose answer never reached us: the video is
                // there under this name already, so carry on with it.
                ticket = await AdoptAsync(externalId, body.SizeBytes, cancellationToken);
            }
        }

        if (!ticket.IsOk) return MediaFailure<RecordingUploadResponse>(ticket.Outcome, ticket.Message);

        var issued = ticket.Value!;
        var isNew = row is null;
        row ??= new MatchRecording
        {
            MatchId = request.MatchId,
            RiotAccountId = account.Id,
            VideoId = issued.VideoId,
            ExternalId = externalId,
            Status = RecordingStatuses.Uploading
        };

        row.VideoId = issued.VideoId;
        row.ExternalId = externalId;
        row.Status = RecordingStatuses.Uploading;
        row.Error = null;
        row.Title = body.Title!.Trim();
        row.DurationSeconds = body.DurationSeconds;
        row.SizeBytes = body.SizeBytes;
        row.EventsJson = body.Events is null ? null : Recordings.SerializeEvents(body.Events);
        row.AttachedByUserId = userId;
        row.AttachedAt = now;
        row.ReadyAt = null;
        row.CheckedAt = now;

        if (isNew) db.MatchRecordings.Add(row);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two uploads of the same game at once. The key decides; the loser
            // asks again and is handed the winner's video.
            return Response<RecordingUploadResponse>.Failure(
                new Error("recording_exists", "A recording was just started for this game. Try again."),
                HttpStatusCode.Conflict);
        }

        logger.LogInformation(
            "Upload of {VideoId} ({SizeBytes} bytes) for {MatchId} on {RiotAccountId} started by {UserId}",
            row.VideoId, row.SizeBytes, row.MatchId, account.Id, userId);

        await events.RecordingChangedAsync(account.Id, row.MatchId, cancellationToken);

        return new RecordingUploadResponse(issued.VideoId, issued.UploadUrl, issued.UploadToken, issued.ExpiresAt, issued.MaxBytes);
    }

    private async Task<MediaResult<MediaUploadTicket>> AdoptAsync(string externalId, long sizeBytes, CancellationToken cancellationToken)
    {
        var found = await media.GetByExternalIdAsync(externalId, cancellationToken);
        if (!found.IsOk) return new(found.Outcome == MediaOutcome.NotFound ? MediaOutcome.Conflict : found.Outcome, null, found.Message);
        return await media.RenewUploadAsync(found.Value!.Id, sizeBytes, cancellationToken);
    }

    /// <summary>
    /// Foxfire Media would not issue a token: the upload is still running, or
    /// it finished and the row had not heard. Find out which, and say so.
    /// </summary>
    private async Task<Response<RecordingUploadResponse>> RefusedAsInFlightAsync(
        MatchRecording row, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var video = await media.GetVideoAsync(row.VideoId, cancellationToken);
        if (video.IsOk)
        {
            Recordings.Apply(row, video.Value!, now);
            await db.SaveChangesAsync(cancellationToken);
            if (row.Status != RecordingStatuses.Uploading) return Exists(row);
        }

        return Response<RecordingUploadResponse>.Failure(
            new Error(
                "upload_in_progress",
                "This recording is already being uploaded. If that upload has stopped, it can be started again in a few minutes."),
            HttpStatusCode.Conflict);
    }

    /// <summary>A new name for a replacement, because Foxfire Media keeps the old one until its files are gone.</summary>
    private static string Replacement(Guid riotAccountId, string matchId, DateTimeOffset now) =>
        $"{Recordings.ExternalId(matchId, riotAccountId)}_{now.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture)}";

    private static Response<RecordingUploadResponse> Exists(MatchRecording existing) =>
        Response<RecordingUploadResponse>.Failure(
            new Error(
                "recording_exists",
                existing.Title is { } title
                    ? $"This game already has a recording on the server: “{title}”."
                    : "This game already has a recording on the server."),
            HttpStatusCode.Conflict);

    internal static Response<T> MediaFailure<T>(MediaOutcome outcome, string? message) => outcome switch
    {
        MediaOutcome.Full => Response<T>.Failure(
            new Error("media_full", "The server's video storage is full. Its host has to make room before more recordings fit."),
            HttpStatusCode.InsufficientStorage),
        MediaOutcome.Invalid => Response<T>.Failure(
            new Error("invalid_upload", message ?? "Foxfire Media would not take that recording."),
            HttpStatusCode.BadRequest),
        MediaOutcome.NotFound => Response<T>.Failure(
            new Error("video_missing", "That recording's video is no longer on the server."),
            HttpStatusCode.NotFound),
        _ => Response<T>.Failure(
            new Error("media_unavailable", "The server's video storage is not answering. Try again shortly."),
            HttpStatusCode.ServiceUnavailable),
    };
}
