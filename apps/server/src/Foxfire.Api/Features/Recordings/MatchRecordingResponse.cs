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

/// <summary>A recording as its page reads it. See MatchRecording on the TypeScript side.</summary>
public sealed record MatchRecordingResponse(
    string VideoId,
    string Status,
    bool HasEvents,
    string? Title,
    int? DurationSeconds,
    string? Error,
    string? AttachedBy,
    DateTimeOffset AttachedAt,
    DateTimeOffset? ReadyAt,
    IReadOnlyList<RecordingEventDto> Events);

/// <summary>
/// Where to send a recording's file and the one-time token that lets it in.
///
/// The token is the only credential in it, and it opens one upload of one
/// file: it must be used within Foxfire Media's window to start, is spent by
/// starting, and after that only resumes that same upload. Nothing logs it.
/// </summary>
public sealed record RecordingUploadResponse(
    string VideoId,
    string UploadUrl,
    string UploadToken,
    DateTimeOffset ExpiresAt,
    long MaxBytes);

/// <summary>
/// A page that plays one recording, framed by a client. Short-lived and good
/// only for loading — the player keeps its own playback going after that —
/// so a client asks for one each time it opens a recording.
/// </summary>
public sealed record RecordingEmbedResponse(string EmbedUrl, string? PosterUrl, DateTimeOffset ExpiresAt);
