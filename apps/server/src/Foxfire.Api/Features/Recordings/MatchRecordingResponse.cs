namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// One thing that happened to the player whose screen the recording is.
///
/// The desktop's RecordingEvent, field for field: it captured these while the
/// game was played, and the web draws them exactly as the desktop's own player
/// does.
/// </summary>
public sealed record RecordingEventDto(
    int EventId,
    string Name,
    double GameTime,
    double VideoTime,
    string Role,
    string? Label);

/// <summary>
/// A recording as its page reads it.
///
/// Spelled YoutubeVideoId rather than YouTubeVideoId so the camelCase the wire
/// uses comes out as the youtubeVideoId the TypeScript side reads, rather than
/// youTubeVideoId.
/// </summary>
public sealed record MatchRecordingResponse(
    string YoutubeVideoId,
    string? Privacy,
    bool HasEvents,
    string? Title,
    int? DurationSeconds,
    string Source,
    string? AttachedBy,
    DateTimeOffset AttachedAt,
    IReadOnlyList<RecordingEventDto> Events);
