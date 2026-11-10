using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using Foxfire.Api.Media;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Foxfire Media, as far as the server can tell.
///
/// Substituted at the HttpMessageHandler, as FakeRiot and FakeResend are, so
/// everything between a handler and the socket is the real thing: the key
/// header, the JSON both ways, the sorting of every status into an outcome. It
/// keeps its videos in memory, refuses what Foxfire Media refuses (a taken
/// externalId, a token for a video past uploading, a wrong key), and signs
/// webhooks with the key the fixture's host is configured with.
///
/// One of these sits behind the fixture's own host and every host made from
/// it, so a test finds its videos by the ids its own uploads were given.
/// </summary>
public sealed class FakeMedia
{
    public const string BaseUrl = "https://media.test.example.com";

    public const string ApiKey = "media-test-key-not-real-0123456789abcdef";

    private readonly Lock _gate = new();
    private readonly Dictionary<string, Video> _videos = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<HttpStatusCode>> _scripted = new(StringComparer.Ordinal);
    private readonly List<string> _deleted = [];
    private readonly List<string> _tokens = [];

    public sealed class Video
    {
        public required string Id { get; init; }
        public required string ExternalId { get; init; }
        public required string Title { get; init; }
        public string Status { get; set; } = "AwaitingUpload";
        public long SizeBytes { get; set; }
        public long? DurationMs { get; set; }
        public string? Error { get; set; }
        public int Tickets { get; set; }
    }

    /// <summary>Every upload token this fake has handed out — for checking none of them reaches a log.</summary>
    public IReadOnlyList<string> Tokens
    {
        get { lock (_gate) return [.. _tokens]; }
    }

    public IReadOnlyList<string> Deleted
    {
        get { lock (_gate) return [.. _deleted]; }
    }

    public Video? Find(string videoId)
    {
        lock (_gate) return _videos.GetValueOrDefault(videoId);
    }

    /// <summary>Drops a video without telling anybody, as Foxfire Media's sweep of abandoned uploads does.</summary>
    public void Forget(string videoId)
    {
        lock (_gate) _videos.Remove(videoId);
    }

    /// <summary>Moves a video on, as Foxfire Media's own upload and processing would.</summary>
    public void Set(string videoId, string status, long? durationMs = null, string? error = null)
    {
        lock (_gate)
        {
            var video = _videos[videoId];
            video.Status = status;
            video.DurationMs = durationMs ?? video.DurationMs;
            video.Error = error;
        }
    }

    /// <summary>Answers the next request whose path ends with <paramref name="pathSuffix"/> with this status instead.</summary>
    public FakeMedia ThenFail(string pathSuffix, HttpStatusCode status)
    {
        lock (_gate)
        {
            if (!_scripted.TryGetValue(pathSuffix, out var queue)) _scripted[pathSuffix] = queue = new();
            queue.Enqueue(status);
        }

        return this;
    }

    /// <summary>The settings a host keeps its recordings here with.</summary>
    public static IEnumerable<KeyValuePair<string, string?>> Settings =>
    [
        new("Media__BaseUrl", BaseUrl),
        new("Media__ApiKey", ApiKey),
    ];

    /// <summary>Wires the fake under a host's named client.</summary>
    public void Install(IServiceCollection services) =>
        services.AddHttpClient(FoxfireMediaClient.HttpClientName)
            .ConfigurePrimaryHttpMessageHandler(() => new StubHandler(this));

    /// <summary>A host with Foxfire Media switched off, over the same database.</summary>
    public static WebApplicationFactory<Program> Off(WebApplicationFactory<Program> parent) =>
        parent.WithWebHostBuilder(builder => builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Media:BaseUrl"] = "",
                ["Media:ApiKey"] = ""
            })));

    /// <summary>A webhook as Foxfire Media would send it about one video, signed with the key (or another).</summary>
    public static HttpRequestMessage Webhook(
        string type, string videoId, string status, long? durationMs = null, string? error = null,
        DateTimeOffset? at = null, string? key = null)
    {
        var sentAt = at ?? DateTimeOffset.UtcNow;
        var body = JsonSerializer.Serialize(new
        {
            id = $"evt_{Guid.NewGuid():N}",
            type,
            createdAt = sentAt,
            data = new { videoId, externalId = (string?)null, title = "t", status, durationMs, width = 1920, height = 1080, error }
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        var bytes = Encoding.UTF8.GetBytes(body);
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri("/api/media/webhooks", UriKind.Relative))
        {
            Content = new ByteArrayContent(bytes)
        };
        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        request.Headers.Add(MediaSignature.Header, MediaSignature.Sign(bytes, key ?? ApiKey, sentAt));
        return request;
    }

    private HttpResponseMessage Answer(HttpMethod method, string path, JsonElement? body)
    {
        lock (_gate)
        {
            foreach (var (suffix, queue) in _scripted)
            {
                if (path.EndsWith(suffix, StringComparison.Ordinal) && queue.Count > 0)
                {
                    return Problem(queue.Dequeue(), "scripted");
                }
            }

            var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);

            if (method == HttpMethod.Get && path == "me")
            {
                return Json(HttpStatusCode.OK, new
                {
                    name = "Foxfire",
                    displayName = "Foxfire",
                    allowedOrigins = new[] { "https://test.example.com" },
                    webhookUrl = "https://test.example.com/api/media/webhooks"
                });
            }

            if (method == HttpMethod.Post && path == "uploads")
            {
                var b = body!.Value;
                var externalId = b.GetProperty("externalId").GetString()!;
                if (_videos.Values.Any(v => v.ExternalId == externalId)) return Problem(HttpStatusCode.Conflict, "externalId taken");

                var video = new Video
                {
                    Id = NewId(),
                    ExternalId = externalId,
                    Title = b.GetProperty("title").GetString()!,
                    SizeBytes = b.GetProperty("sizeBytes").GetInt64()
                };
                _videos[video.Id] = video;
                return Ticket(video, HttpStatusCode.Created);
            }

            if (parts is ["videos", "by-external-id", var ext] && method == HttpMethod.Get)
            {
                var external = Uri.UnescapeDataString(ext);
                var found = _videos.Values.FirstOrDefault(v => v.ExternalId == external);
                return found is null ? Problem(HttpStatusCode.NotFound, "Not found.") : Json(HttpStatusCode.OK, Describe(found));
            }

            if (parts is not ["videos", var id, ..] || !_videos.TryGetValue(id, out var target))
            {
                return Problem(HttpStatusCode.NotFound, "Not found.");
            }

            if (parts is [_, _] && method == HttpMethod.Get) return Json(HttpStatusCode.OK, Describe(target));

            if (parts is [_, _] && method == HttpMethod.Delete)
            {
                _videos.Remove(id);
                _deleted.Add(id);
                return new HttpResponseMessage(HttpStatusCode.NoContent);
            }

            if (parts is [_, _, "upload-token"] && method == HttpMethod.Post)
            {
                if (target.Status is not ("AwaitingUpload" or "UploadFailed" or "UploadExpired"))
                {
                    return Problem(HttpStatusCode.Conflict, $"video is {target.Status}");
                }

                if (body?.TryGetProperty("sizeBytes", out var size) == true) target.SizeBytes = size.GetInt64();
                target.Status = "AwaitingUpload";
                return Ticket(target, HttpStatusCode.OK);
            }

            if (parts is [_, _, "embed"] && method == HttpMethod.Post)
            {
                return Json(HttpStatusCode.OK, new
                {
                    embedUrl = $"{BaseUrl}/embed/emb_{id}",
                    posterUrl = $"{BaseUrl}/poster/pst_{id}",
                    expiresAt = DateTimeOffset.UtcNow.AddHours(1)
                });
            }

            return Problem(HttpStatusCode.NotFound, "Not found.");
        }
    }

    private HttpResponseMessage Ticket(Video video, HttpStatusCode status)
    {
        video.Tickets++;
        var token = $"v1.upload-token-{Guid.NewGuid():N}";
        _tokens.Add(token);
        return Json(status, new
        {
            videoId = video.Id,
            uploadUrl = $"{BaseUrl}/uploads/tus",
            uploadToken = token,
            expiresAt = DateTimeOffset.UtcNow.AddMinutes(15),
            maxBytes = video.SizeBytes
        });
    }

    private static object Describe(Video v) => new
    {
        id = v.Id,
        externalId = v.ExternalId,
        title = v.Title,
        description = (string?)null,
        status = v.Status,
        durationMs = v.DurationMs,
        width = 1920,
        height = 1080,
        sizeBytes = v.SizeBytes,
        error = v.Error,
        createdAt = DateTimeOffset.UtcNow,
        readyAt = v.Status == "Ready" ? DateTimeOffset.UtcNow : (DateTimeOffset?)null
    };

    private static string NewId()
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        return string.Create(11, Random.Shared, (span, random) =>
        {
            for (var i = 0; i < span.Length; i++) span[i] = alphabet[random.Next(alphabet.Length)];
        });
    }

    private static HttpResponseMessage Json(HttpStatusCode status, object value) =>
        new(status)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(value, new JsonSerializerOptions(JsonSerializerDefaults.Web)), Encoding.UTF8, "application/json")
        };

    private static HttpResponseMessage Problem(HttpStatusCode status, string title) =>
        new(status)
        {
            Content = new StringContent(
                $$"""{"status":{{((int)status).ToString(CultureInfo.InvariantCulture)}},"title":"{{title}}"}""",
                Encoding.UTF8,
                "application/problem+json")
        };

    private sealed class StubHandler(FakeMedia fake) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (!request.Headers.TryGetValues("X-Api-Key", out var keys) || keys.Single() != ApiKey)
            {
                return Problem(HttpStatusCode.Unauthorized, "Unauthorized");
            }

            var path = request.RequestUri!.AbsolutePath;
            const string prefix = "/api/v1/";
            if (!path.StartsWith(prefix, StringComparison.Ordinal)) return Problem(HttpStatusCode.NotFound, "Not found.");

            JsonElement? body = null;
            if (request.Content is not null)
            {
                var text = await request.Content.ReadAsStringAsync(cancellationToken);
                if (text.Length > 0) body = JsonDocument.Parse(text).RootElement.Clone();
            }

            return fake.Answer(request.Method, path[prefix.Length..], body);
        }
    }
}
