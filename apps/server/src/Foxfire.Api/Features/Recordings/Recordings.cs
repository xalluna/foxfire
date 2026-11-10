using System.Text.Json;
using Foxfire.Api.Media;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// What every recording handler agrees on: what an event may carry, what a
/// video's state reads as, and how a row becomes the shape the screens read.
/// </summary>
internal static class Recordings
{
    public static readonly string[] Roles = ["kill", "death", "assist", "multikill"];

    /// <summary>A long game has perhaps a hundred of these. A thousand is a request that is not a game.</summary>
    public const int MaxEvents = 1_000;

    /// <summary>Six hours: past any game Riot has let run, and a bound on what a marker can claim.</summary>
    public const double MaxSeconds = 21_600;

    public const int MaxTextLength = 64;

    /// <summary>Foxfire Media's own title limit.</summary>
    public const int MaxTitleLength = 200;

    /// <summary>
    /// The id this server gives Foxfire Media for a recording: the game and the
    /// account, which is the row's key. Deterministic, so an upload whose answer
    /// was lost finds the video it already made rather than being refused a second.
    /// </summary>
    public static string ExternalId(string matchId, Guid riotAccountId) => $"rec_{matchId}_{riotAccountId:N}";

    /// <summary>The same camelCase the wire uses, so what is stored is what was sent.</summary>
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static string SerializeEvents(IReadOnlyList<RecordingEventDto> events) =>
        JsonSerializer.Serialize(events, Json);

    /// <summary>
    /// The stored events, or none.
    ///
    /// A column that will not parse is treated as no markers rather than as a
    /// failure: the video is the recording, and a page that refused to play it
    /// over a timeline it could not draw would be the worse outcome.
    /// </summary>
    public static IReadOnlyList<RecordingEventDto> DeserializeEvents(string? json)
    {
        if (string.IsNullOrEmpty(json)) return [];
        try
        {
            return JsonSerializer.Deserialize<List<RecordingEventDto>>(json, Json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    public static bool IsReasonable(RecordingEventDto? e) =>
        e is not null
        && Roles.Contains(e.Role)
        && !string.IsNullOrEmpty(e.Name) && e.Name.Length <= MaxTextLength
        && (e.Label is null || e.Label.Length <= MaxTextLength)
        && double.IsFinite(e.GameTime) && e.GameTime is >= 0 and <= MaxSeconds
        && double.IsFinite(e.VideoTime) && e.VideoTime is >= 0 and <= MaxSeconds;

    /// <summary>Takes in what Foxfire Media says of the video now, whatever the row said before.</summary>
    public static void Apply(MatchRecording row, MediaVideo video, DateTimeOffset now)
    {
        row.Status = RecordingStatuses.FromMedia(video.Status);
        row.Error = row.Status is RecordingStatuses.Failed or RecordingStatuses.UploadFailed ? Clip(video.Error) : null;
        if (video.DurationMs is { } ms) row.DurationSeconds = (int)Math.Round(ms / 1000.0);
        if (row.Status == RecordingStatuses.Ready) row.ReadyAt ??= video.ReadyAt ?? now;
        row.CheckedAt = now;
    }

    public static string? Clip(string? error) => error is { Length: > 500 } ? error[..500] : error;

    public static MatchRecordingResponse ToResponse(MatchRecording row, string? attachedBy) =>
        new(
            row.VideoId,
            row.Status,
            row.EventsJson is not null,
            row.Title,
            row.DurationSeconds,
            row.Error,
            attachedBy,
            row.AttachedAt,
            row.ReadyAt,
            DeserializeEvents(row.EventsJson));
}

/// <summary>
/// A recording's state, as clients read it. Foxfire Media has more of them;
/// these are the ones that change what a client does.
/// </summary>
public static class RecordingStatuses
{
    /// <summary>Waiting for the file, or receiving it.</summary>
    public const string Uploading = "uploading";

    /// <summary>The upload stopped or its token lapsed. The desktop asks for a new token and starts it again.</summary>
    public const string UploadFailed = "upload_failed";

    /// <summary>All of the file is there and Foxfire Media is making it playable.</summary>
    public const string Processing = "processing";

    /// <summary>Playable. The one state a desktop may delete its own copy in.</summary>
    public const string Ready = "ready";

    /// <summary>Foxfire Media could not process it.</summary>
    public const string Failed = "failed";

    public static string FromMedia(string? status) => status switch
    {
        "AwaitingUpload" or "Uploading" => Uploading,
        "UploadFailed" or "UploadExpired" => UploadFailed,
        "Queued" or "Processing" => Processing,
        "Ready" => Ready,
        "Failed" => Failed,
        _ => Processing,
    };

    /// <summary>
    /// How far along a state is, for webhooks: one only ever moves a row forward
    /// (or sideways), so a delivery retried late cannot undo a later one. A
    /// failed processing can still become ready — an admin re-processing it on
    /// Foxfire Media — so failed sits below ready.
    /// </summary>
    public static int Rank(string status) => status switch
    {
        Uploading or UploadFailed => 0,
        Processing => 1,
        Failed => 2,
        Ready => 3,
        _ => 0,
    };
}
