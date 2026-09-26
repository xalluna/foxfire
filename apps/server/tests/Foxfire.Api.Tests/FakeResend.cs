using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Foxfire.Api.Email;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email.Resend;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Resend, as far as the server can tell.
///
/// Substituted at the HttpMessageHandler, as FakeRiot is, so everything between
/// the dispatcher and the socket is the real thing: the provider's headers, the
/// JSON, the sorting of every answer, the idempotency key. It records each send
/// with the link pulled out of it, answers however a test scripts it, and signs
/// webhooks with a secret the host it builds is configured to trust.
///
/// A host from <see cref="Host"/> sends mail; the fixture's own host does not.
/// They share one database, and the dispatcher sends whatever is queued for
/// Resend in it — so a test finds its own mail by its own unique recipient,
/// never by counting everything the fake saw.
/// </summary>
public sealed partial class FakeResend
{
    /// <summary>A webhook signing secret, in Svix's form.</summary>
    public static readonly string WebhookSecret =
        "whsec_" + Convert.ToBase64String(Encoding.UTF8.GetBytes("foxfire-test-webhook-secret-32b!"));

    public const string FromAddress = "foxfire@mail.example.com";

    private readonly Lock _gate = new();
    private readonly List<SentEmail> _sent = [];
    private readonly Dictionary<string, Queue<Func<SentEmail, HttpResponseMessage>>> _scripted =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>What the next answers report as used, in the quota headers. Null leaves a header off.</summary>
    public int? ReportDaily { get; set; }

    public int? ReportMonthly { get; set; }

    public IReadOnlyList<SentEmail> Sent
    {
        get { lock (_gate) return [.. _sent]; }
    }

    /// <summary>Every attempt to send to an address, in order.</summary>
    public IReadOnlyList<SentEmail> To(string recipient)
    {
        lock (_gate) return [.. _sent.Where(s => string.Equals(s.To, recipient, StringComparison.OrdinalIgnoreCase))];
    }

    /// <summary>
    /// Answers the next attempt to <paramref name="recipient"/> with this, and the
    /// ones after with the default. By recipient, so that mail some earlier test
    /// left queued cannot use up a failure meant for this one.
    /// </summary>
    public FakeResend ThenAnswer(string recipient, Func<SentEmail, HttpResponseMessage> answer)
    {
        lock (_gate)
        {
            if (!_scripted.TryGetValue(recipient, out var queue)) _scripted[recipient] = queue = new();
            queue.Enqueue(answer);
        }

        return this;
    }

    /// <summary>Answers the next attempt to <paramref name="recipient"/> with a Resend error.</summary>
    public FakeResend ThenFail(string recipient, HttpStatusCode status, string name, int? retryAfterSeconds = null) =>
        ThenAnswer(recipient, _ =>
        {
            var response = Json(status, $$"""{"statusCode":{{(int)status}},"name":"{{name}}","message":"scripted"}""");
            if (retryAfterSeconds is { } seconds) response.Headers.Add("retry-after", seconds.ToString(CultureInfo.InvariantCulture));
            return response;
        });

    /// <summary>
    /// A host that sends mail through this fake. No limits unless asked for —
    /// the database is shared, so the day's count is everybody's.
    /// </summary>
    public WebApplicationFactory<Program> Host(
        WebApplicationFactory<Program> parent,
        IReadOnlyDictionary<string, string?>? settings = null) =>
        parent.WithWebHostBuilder(builder =>
        {
            var config = new Dictionary<string, string?>
            {
                ["Email:Provider"] = "resend",
                ["Email:FromAddress"] = FromAddress,
                ["Email:Resend:ApiKey"] = "re_test_key_not_real",
                ["Email:Resend:WebhookSecret"] = WebhookSecret,
                ["Email:Resend:DailyLimit"] = "0",
                ["Email:Resend:MonthlyLimit"] = "0"
            };

            foreach (var (key, value) in settings ?? new Dictionary<string, string?>()) config[key] = value;

            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(config));
            builder.ConfigureServices(services =>
                services.AddHttpClient(ResendEmailProvider.HttpClientName)
                    .ConfigurePrimaryHttpMessageHandler(() => new StubHandler(this)));
        });

    /// <summary>A webhook as Resend would send it about one message, signed.</summary>
    public static HttpRequestMessage Webhook(string type, string providerMessageId, string? dataExtra = null, DateTimeOffset? at = null)
    {
        var sentAt = at ?? DateTimeOffset.UtcNow;
        var extra = dataExtra is null ? "" : "," + dataExtra;
        var body =
            "{\"type\":\"" + type + "\",\"created_at\":\"" + sentAt.ToString("O", CultureInfo.InvariantCulture)
            + "\",\"data\":{\"email_id\":\"" + providerMessageId + "\",\"to\":[\"x@example.com\"]" + extra + "}}";

        return SignedWebhook(body, sentAt);
    }

    public static HttpRequestMessage SignedWebhook(string body, DateTimeOffset sentAt, string? secret = null)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        var id = $"msg_{Guid.NewGuid():N}";
        var timestamp = sentAt.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);

        var request = new HttpRequestMessage(HttpMethod.Post, new Uri("/api/email/webhooks/resend", UriKind.Relative))
        {
            Content = new ByteArrayContent(bytes)
        };

        request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        request.Headers.Add(SvixSignature.IdHeader, id);
        request.Headers.Add(SvixSignature.TimestampHeader, timestamp);
        request.Headers.Add(SvixSignature.SignatureHeader, SvixSignature.Sign(secret ?? WebhookSecret, id, timestamp, bytes));

        return request;
    }

    /// <summary>
    /// Waits for the newest message to an address to reach a status, and
    /// returns it. The dispatcher runs on its own schedule; a test polls.
    /// </summary>
    public static async Task<EmailMessage> EventuallyAsync(
        IServiceProvider services,
        string recipient,
        Func<EmailMessage, bool> done,
        TimeSpan? timeout = null)
    {
        var deadline = DateTimeOffset.UtcNow + (timeout ?? TimeSpan.FromSeconds(20));
        EmailMessage? last = null;

        while (DateTimeOffset.UtcNow < deadline)
        {
            await using (var scope = services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
                last = await db.EmailMessages
                    .AsNoTracking()
                    .Where(m => m.Recipient == recipient)
                    .OrderByDescending(m => m.CreatedAt)
                    .ThenByDescending(m => m.Id)
                    .FirstOrDefaultAsync();
            }

            if (last is not null && done(last)) return last;

            services.GetRequiredService<EmailSignal>().Poke();
            await Task.Delay(100);
        }

        throw new TimeoutException(
            $"The email to {recipient} never got there; last seen as {last?.Status ?? "nothing"} ({last?.Reason}).");
    }

    /// <summary>Every message to an address, oldest first.</summary>
    public static async Task<List<EmailMessage>> MessagesToAsync(IServiceProvider services, string recipient)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        return await db.EmailMessages
            .AsNoTracking()
            .Where(m => m.Recipient == recipient)
            .OrderBy(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync();
    }

    private HttpResponseMessage Answer(SentEmail email)
    {
        Func<SentEmail, HttpResponseMessage>? scripted;
        lock (_gate) scripted = _scripted.TryGetValue(email.To, out var queue) && queue.Count > 0 ? queue.Dequeue() : null;

        var response = scripted?.Invoke(email) ?? Json(HttpStatusCode.OK, $$"""{"id":"{{email.ProviderId}}"}""");

        if (ReportDaily is { } daily) response.Headers.Add(ResendEmailProvider.DailyQuotaHeader, daily.ToString(CultureInfo.InvariantCulture));
        if (ReportMonthly is { } monthly) response.Headers.Add(ResendEmailProvider.MonthlyQuotaHeader, monthly.ToString(CultureInfo.InvariantCulture));

        return response;
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    [GeneratedRegex(@"https://test\.example\.com/\S+")]
    private static partial Regex LinkPattern();

    /// <summary>One attempt to send, as it reached Resend.</summary>
    /// <param name="ProviderId">The id this fake answers a success with.</param>
    public sealed record SentEmail(
        string? IdempotencyKey,
        string? Authorization,
        string? UserAgent,
        string From,
        string To,
        string Subject,
        string Html,
        string Text,
        string Kind,
        string ProviderId)
    {
        /// <summary>The link in the message, as the plain-text part spells it out.</summary>
        public string? Link => LinkPattern().Match(Text) is { Success: true } match ? match.Value : null;

        /// <summary>The token at the end of the link.</summary>
        public string? Token => Link is { } link ? link[(link.LastIndexOf('/') + 1)..] : null;
    }

    private sealed class StubHandler(FakeResend fake) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null ? "{}" : await request.Content.ReadAsStringAsync(cancellationToken);
            using var json = JsonDocument.Parse(body);
            var root = json.RootElement;

            var kind = root.TryGetProperty("tags", out var tags)
                ? tags.EnumerateArray().FirstOrDefault(t => t.GetProperty("name").GetString() == "kind").GetProperty("value").GetString() ?? ""
                : "";

            var email = new SentEmail(
                request.Headers.TryGetValues("Idempotency-Key", out var keys) ? keys.Single() : null,
                request.Headers.Authorization?.ToString(),
                request.Headers.UserAgent.ToString(),
                root.GetProperty("from").GetString() ?? "",
                root.GetProperty("to")[0].GetString() ?? "",
                root.GetProperty("subject").GetString() ?? "",
                root.GetProperty("html").GetString() ?? "",
                root.GetProperty("text").GetString() ?? "",
                kind,
                $"re_{Guid.NewGuid():N}");

            lock (fake._gate) fake._sent.Add(email);

            return fake.Answer(email);
        }
    }
}
