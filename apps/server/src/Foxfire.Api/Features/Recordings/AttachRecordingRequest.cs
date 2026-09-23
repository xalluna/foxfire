using System.Net;
using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Recordings;

/// <summary>What attaching a recording sends. See AttachRecordingInput on the TypeScript side.</summary>
public sealed record AttachRecordingBody(
    string? YoutubeVideoId,
    string? Source,
    string? Privacy,
    string? Title,
    int? DurationSeconds,
    IReadOnlyList<RecordingEventDto>? Events,
    bool Replace = false);

public sealed record AttachRecordingRequest(Guid RiotAccountId, string MatchId, AttachRecordingBody Body)
    : IValidatedRequest<MatchRecordingResponse>;

internal sealed class AttachRecordingRequestValidator : AbstractValidator<AttachRecordingRequest>
{
    public AttachRecordingRequestValidator()
    {
        RuleFor(x => x.Body.YoutubeVideoId ?? string.Empty)
            .Must(id => Recordings.VideoId().IsMatch(id))
            .WithErrorCode("invalid_video")
            .WithMessage("That is not a YouTube video id.");

        RuleFor(x => x.Body.Source)
            .Must(source => source is not null && Recordings.Sources.Contains(source))
            .WithErrorCode("invalid_source")
            .WithMessage("A recording is either uploaded or linked.");

        RuleFor(x => x.Body.Privacy)
            .Must(privacy => privacy is null || Recordings.Privacies.Contains(privacy))
            .WithErrorCode("invalid_privacy")
            .WithMessage("Privacy is public, unlisted or private.");

        RuleFor(x => x.Body.Title)
            .MaximumLength(100)
            .WithErrorCode("invalid_title")
            .WithMessage("A YouTube title is at most 100 characters.");

        RuleFor(x => x.Body.DurationSeconds)
            .InclusiveBetween(0, (int)Recordings.MaxSeconds)
            .When(x => x.Body.DurationSeconds is not null)
            .WithErrorCode("invalid_duration")
            .WithMessage("That is not a length a game can be.");

        RuleFor(x => x.Body.Events)
            .Must(events => events is null || (events.Count <= Recordings.MaxEvents && events.All(IsReasonable)))
            .WithErrorCode("invalid_events")
            .WithMessage("The recording's markers were not ones a game produces.");
    }

    private static bool IsReasonable(RecordingEventDto? e) =>
        e is not null
        && Recordings.Roles.Contains(e.Role)
        && !string.IsNullOrEmpty(e.Name) && e.Name.Length <= Recordings.MaxTextLength
        && (e.Label is null || e.Label.Length <= Recordings.MaxTextLength)
        && double.IsFinite(e.GameTime) && e.GameTime is >= 0 and <= Recordings.MaxSeconds
        && double.IsFinite(e.VideoTime) && e.VideoTime is >= 0 and <= Recordings.MaxSeconds;
}

/// <summary>
/// Attaches a YouTube video to one account's view of one game, as that account's owner.
///
/// Owner only, and admins included in the refusal — the same rule as a rank
/// reading, and for the same reason: saying "this video is my screen in that
/// game" is a claim about somebody's account, not a request for something Riot
/// already published. Nobody can check it but the person making it.
///
/// One recording per game per account. A second one answers 409 unless the
/// caller has asked somebody and been told to replace it.
/// </summary>
internal sealed class AttachRecordingRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    AccountOwnership ownership,
    IServerEvents events,
    TimeProvider time,
    ILogger<AttachRecordingRequestHandler> logger)
    : IValidatedRequestHandler<AttachRecordingRequest, MatchRecordingResponse>
{
    public async Task<Response<MatchRecordingResponse>> Handle(
        AttachRecordingRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (me.UserId is not { } userId)
        {
            return Response<MatchRecordingResponse>.Failure(
                new Error("unauthenticated", "Sign in again."), HttpStatusCode.Unauthorized);
        }

        var account = await ownership.MineAsync(request.RiotAccountId, cancellationToken);
        if (account is null)
        {
            return Response<MatchRecordingResponse>.Failure(AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);
        }

        var played = await db.MatchParticipants
            .AnyAsync(p => p.MatchId == request.MatchId && p.Puuid == account.Puuid, cancellationToken);

        if (!played)
        {
            return Response<MatchRecordingResponse>.Failure(
                new Error("not_in_match", "That League account is not in that game on this server."),
                HttpStatusCode.NotFound);
        }

        var body = request.Body;
        var existing = await db.MatchRecordings
            .FirstOrDefaultAsync(
                r => r.MatchId == request.MatchId && r.RiotAccountId == account.Id,
                cancellationToken);

        if (existing is not null && !body.Replace) return Exists(existing);

        var row = existing ?? new MatchRecording
        {
            MatchId = request.MatchId,
            RiotAccountId = account.Id,
            YouTubeVideoId = body.YoutubeVideoId!,
            Source = body.Source!
        };

        row.YouTubeVideoId = body.YoutubeVideoId!;
        row.Source = body.Source!;
        row.Privacy = body.Privacy;
        row.Title = string.IsNullOrWhiteSpace(body.Title) ? null : body.Title.Trim();
        row.DurationSeconds = body.DurationSeconds;
        row.EventsJson = body.Events is null ? null : Recordings.SerializeEvents(body.Events);
        row.AttachedByUserId = userId;
        row.AttachedAt = time.GetUtcNow();

        if (existing is null) db.MatchRecordings.Add(row);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two attaches to the same game at once, from the owner's desktop
            // and their browser. The key decides; the loser is asked, like any
            // other second attach.
            return Response<MatchRecordingResponse>.Failure(
                new Error("recording_exists", "A recording was just attached to this game."),
                HttpStatusCode.Conflict);
        }

        logger.LogInformation(
            "Recording {VideoId} attached to {MatchId} for {RiotAccountId} by {UserId}",
            row.YouTubeVideoId, row.MatchId, account.Id, userId);

        await events.RecordingChangedAsync(account.Id, row.MatchId, cancellationToken);

        return Recordings.ToResponse(row, me.Username);
    }

    private static Response<MatchRecordingResponse> Exists(MatchRecording existing) =>
        Response<MatchRecordingResponse>.Failure(
            new Error(
                "recording_exists",
                existing.Title is { } title
                    ? $"This game already has a recording attached: “{title}”."
                    : "This game already has a recording attached."),
            HttpStatusCode.Conflict);
}
