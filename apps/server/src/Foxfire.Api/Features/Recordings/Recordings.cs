using System.Text.Json;
using System.Text.RegularExpressions;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.Recordings;

/// <summary>
/// What every recording handler agrees on: what a video id looks like, what an
/// event may carry, and how a row becomes the shape the screens read.
/// </summary>
internal static partial class Recordings
{
    /// <summary>YouTube's own id format. Anything else is refused rather than stored and built into a URL.</summary>
    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")]
    public static partial Regex VideoId();

    public static readonly string[] Sources = ["upload", "link"];

    public static readonly string[] Privacies = ["public", "unlisted", "private"];

    public static readonly string[] Roles = ["kill", "death", "assist", "multikill"];

    /// <summary>A long game has perhaps a hundred of these. A thousand is a request that is not a game.</summary>
    public const int MaxEvents = 1_000;

    /// <summary>Six hours: past any game Riot has let run, and a bound on what a marker can claim.</summary>
    public const double MaxSeconds = 21_600;

    public const int MaxTextLength = 64;

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

    public static MatchRecordingResponse ToResponse(MatchRecording row, string? attachedBy) =>
        new(
            row.YouTubeVideoId,
            row.Privacy,
            row.EventsJson is not null,
            row.Title,
            row.DurationSeconds,
            row.Source,
            attachedBy,
            row.AttachedAt,
            DeserializeEvents(row.EventsJson));
}
