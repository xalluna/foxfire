using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Configuration;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Media;

/// <summary>An upload ticket: where the desktop sends the file, and the one-time token that lets it.</summary>
public sealed record MediaUploadTicket(string VideoId, string UploadUrl, string UploadToken, DateTimeOffset ExpiresAt, long MaxBytes);

/// <summary>A video as Foxfire Media reports it to the application that owns it.</summary>
public sealed record MediaVideo(
    string Id,
    string? ExternalId,
    string Title,
    string Status,
    long? DurationMs,
    long SizeBytes,
    string? Error,
    DateTimeOffset? ReadyAt);

public sealed record MediaEmbed(string EmbedUrl, string? PosterUrl, DateTimeOffset ExpiresAt);

public sealed record MediaApplication(string Name, IReadOnlyList<string> AllowedOrigins, string? WebhookUrl);

/// <summary>How a call to Foxfire Media went, beyond "here is the answer".</summary>
public enum MediaOutcome
{
    Ok,

    /// <summary>No such video for this application — Foxfire Media says the same of another app's.</summary>
    NotFound,

    /// <summary>The externalId is taken, or the video is in no state for what was asked.</summary>
    Conflict,

    /// <summary>Foxfire Media's disk has no room for the upload (507).</summary>
    Full,

    /// <summary>The request was refused as invalid (400, 413).</summary>
    Invalid,

    /// <summary>The key was refused (401, 403). A host's configuration, not a member's mistake.</summary>
    KeyRefused,

    /// <summary>Foxfire Media did not answer, or answered with a 5xx. Worth trying again.</summary>
    Unavailable,
}

public sealed record MediaResult<T>(MediaOutcome Outcome, T? Value, string? Message = null)
{
    public bool IsOk => Outcome == MediaOutcome.Ok && Value is not null;
}

/// <summary>
/// This server talking to Foxfire Media as one of its applications.
///
/// Every call sends the application key, and nothing here ever logs it — or an
/// upload token, or an embed URL, which are bearer credentials for one video.
/// No call throws for an answer: each becomes a <see cref="MediaOutcome"/> the
/// handler can turn into something a member can act on.
/// </summary>
public sealed class FoxfireMediaClient(
    IHttpClientFactory http,
    IOptions<MediaOptions> options,
    ILogger<FoxfireMediaClient> logger)
{
    public const string HttpClientName = "foxfire-media";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public bool IsEnabled => options.Value.IsEnabled;

    public Task<MediaResult<MediaUploadTicket>> CreateUploadAsync(
        string title, string filename, long sizeBytes, string externalId, string? description, CancellationToken ct) =>
        SendAsync<MediaUploadTicket>(
            HttpMethod.Post, "uploads",
            new { title, filename, sizeBytes, externalId, description }, ct);

    public Task<MediaResult<MediaUploadTicket>> RenewUploadAsync(string videoId, long sizeBytes, CancellationToken ct) =>
        SendAsync<MediaUploadTicket>(HttpMethod.Post, $"videos/{Uri.EscapeDataString(videoId)}/upload-token", new { sizeBytes }, ct);

    public Task<MediaResult<MediaVideo>> GetVideoAsync(string videoId, CancellationToken ct) =>
        SendAsync<MediaVideo>(HttpMethod.Get, $"videos/{Uri.EscapeDataString(videoId)}", null, ct);

    public Task<MediaResult<MediaVideo>> GetByExternalIdAsync(string externalId, CancellationToken ct) =>
        SendAsync<MediaVideo>(HttpMethod.Get, $"videos/by-external-id/{Uri.EscapeDataString(externalId)}", null, ct);

    public Task<MediaResult<MediaEmbed>> CreateEmbedAsync(string videoId, CancellationToken ct) =>
        SendAsync<MediaEmbed>(
            HttpMethod.Post, $"videos/{Uri.EscapeDataString(videoId)}/embed",
            new { ttlSeconds = (int)options.Value.EmbedLifetime.TotalSeconds }, ct);

    public Task<MediaResult<MediaApplication>> MeAsync(CancellationToken ct) =>
        SendAsync<MediaApplication>(HttpMethod.Get, "me", null, ct);

    /// <summary>Deletes the video and its files. A video already gone counts as deleted.</summary>
    public async Task<MediaOutcome> DeleteVideoAsync(string videoId, CancellationToken ct)
    {
        var result = await SendAsync<object>(HttpMethod.Delete, $"videos/{Uri.EscapeDataString(videoId)}", null, ct, emptyIsOk: true);
        return result.Outcome == MediaOutcome.NotFound ? MediaOutcome.Ok : result.Outcome;
    }

    private async Task<MediaResult<T>> SendAsync<T>(
        HttpMethod method, string path, object? body, CancellationToken ct, bool emptyIsOk = false)
    {
        var settings = options.Value;
        if (!settings.IsEnabled) return new(MediaOutcome.Unavailable, default, "Recordings are not set up on this server.");

        using var request = new HttpRequestMessage(method, $"{settings.BaseUrl.TrimEnd('/')}/api/v1/{path}");
        request.Headers.Add("X-Api-Key", settings.ApiKey);
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);

        HttpResponseMessage response;
        try
        {
            response = await http.CreateClient(HttpClientName).SendAsync(request, ct);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            logger.LogWarning("Foxfire Media did not answer {Method} {Path}: {Reason}", method.Method, path, e.Message);
            return new(MediaOutcome.Unavailable, default, "Foxfire Media did not answer.");
        }

        using (response)
        {
            var outcome = OutcomeOf(response.StatusCode);
            if (outcome != MediaOutcome.Ok)
            {
                var message = await ProblemTitleAsync(response, ct);
                var level = outcome is MediaOutcome.KeyRefused or MediaOutcome.Unavailable ? LogLevel.Warning : LogLevel.Debug;
                logger.Log(level, "Foxfire Media answered {Method} {Path} with {Status}: {Message}",
                    method.Method, path, (int)response.StatusCode, message);
                return new(outcome, default, message);
            }

            if (emptyIsOk || response.StatusCode == HttpStatusCode.NoContent) return new(MediaOutcome.Ok, (T)(object)true);

            try
            {
                var value = await response.Content.ReadFromJsonAsync<T>(Json, ct);
                return value is null ? new(MediaOutcome.Unavailable, default, "Foxfire Media sent no answer.") : new(MediaOutcome.Ok, value);
            }
            catch (JsonException)
            {
                logger.LogWarning("Foxfire Media answered {Method} {Path} with something that is not its JSON", method.Method, path);
                return new(MediaOutcome.Unavailable, default, "Foxfire Media's answer could not be read.");
            }
        }
    }

    internal static MediaOutcome OutcomeOf(HttpStatusCode status) => (int)status switch
    {
        >= 200 and < 300 => MediaOutcome.Ok,
        404 => MediaOutcome.NotFound,
        409 => MediaOutcome.Conflict,
        507 => MediaOutcome.Full,
        400 or 413 or 422 => MediaOutcome.Invalid,
        401 or 403 => MediaOutcome.KeyRefused,
        _ => MediaOutcome.Unavailable,
    };

    private static async Task<string?> ProblemTitleAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            return doc.RootElement.TryGetProperty("title", out var title) && title.ValueKind == JsonValueKind.String
                ? title.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
