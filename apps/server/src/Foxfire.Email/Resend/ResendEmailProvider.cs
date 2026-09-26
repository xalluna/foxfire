using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Foxfire.Email.Resend;

/// <summary>
/// Sending through Resend's API.
///
/// Written against the HTTP API rather than Resend's SDK, for the reason the
/// Riot client is: what the server needs from a response is in its headers —
/// how much of the quota is gone, how long to wait after a 429 — and a client
/// that hands back a parsed body and nothing else would hide exactly that.
///
/// Every answer is sorted into an <see cref="EmailSendResult"/> and nothing is
/// thrown. The body of a failure is read for its error name and dropped: it can
/// quote the address, and the API key never appears in a log line at all.
/// </summary>
public sealed class ResendEmailProvider : IEmailProvider, IEmailWebhookReceiver
{
    /// <summary>The named HttpClient this reaches Resend through.</summary>
    public const string HttpClientName = "resend";

    public const string DailyQuotaHeader = "x-resend-daily-quota";
    public const string MonthlyQuotaHeader = "x-resend-monthly-quota";

    private static readonly Uri Endpoint = new("https://api.resend.com/emails");

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _http;
    private readonly ResendOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger _log;

    public ResendEmailProvider(
        IHttpClientFactory http,
        ResendOptions options,
        TimeProvider time,
        ILogger<ResendEmailProvider>? logger = null)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(time);

        _http = http;
        _options = options;
        _time = time;
        _log = logger ?? NullLogger<ResendEmailProvider>.Instance;
    }

    public string Name => EmailProviders.Resend;

    public EmailLimits Limits => _options.Limits;

    public bool CanVerify => SvixSignature.IsWellFormedSecret(_options.WebhookSecret);

    public async Task<EmailSendResult> SendAsync(OutboundEmail message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        using var request = new HttpRequestMessage(HttpMethod.Post, Endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        // The outbox row's id, so that a retry after a timeout that did get
        // through is recognised as the same message rather than sent again.
        request.Headers.TryAddWithoutValidation("Idempotency-Key", message.MessageId.ToString());

        request.Content = JsonContent.Create(
            new SendBody(
                message.From,
                [message.To],
                message.Subject,
                message.Html,
                message.Text,
                [.. message.Tags.Select(t => new SendTag(t.Key, t.Value))]),
            options: Json);

        // A client per call, as the Riot client does it: the factory pools and
        // rotates handlers, and a provider holding one forever would pin its DNS.
        var http = _http.CreateClient(HttpClientName);

        // Resend refuses a request with no User-Agent. The server's named client
        // carries one; this is for a client that was not configured.
        if (http.DefaultRequestHeaders.UserAgent.Count == 0) request.Headers.UserAgent.ParseAdd("Foxfire-Server");

        try
        {
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var usage = UsageFrom(response);

            if (response.IsSuccessStatusCode)
            {
                var accepted = await ReadAsync<SendAnswer>(response, cancellationToken).ConfigureAwait(false);

                // Resend always names what it accepted. An answer that does not
                // is retried under the same idempotency key, which Resend
                // answers with the original rather than sending twice.
                return accepted?.Id is { Length: > 0 } id
                    ? new EmailSendResult.Accepted(id, usage)
                    : new EmailSendResult.Transient("unreadable_answer", null, usage);
            }

            var failure = await ReadAsync<ErrorAnswer>(response, cancellationToken).ConfigureAwait(false);
            var result = Classify(response, failure?.Name, usage);

            _log.LogDebug(
                "Resend answered {Status} {Name} for message {MessageId}",
                (int)response.StatusCode, failure?.Name ?? "(no name)", message.MessageId);

            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            // The client's own timeout rather than the caller's cancellation.
            return new EmailSendResult.Transient("timeout", null, null);
        }
        catch (HttpRequestException ex)
        {
            _log.LogDebug(ex, "Could not reach Resend for message {MessageId}", message.MessageId);
            return new EmailSendResult.Transient("network", null, null);
        }
    }

    public WebhookVerdict Verify(Func<string, string?> header, ReadOnlySpan<byte> body, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(header);

        return SvixSignature.Verify(
            _options.WebhookSecret,
            header(SvixSignature.IdHeader),
            header(SvixSignature.TimestampHeader),
            header(SvixSignature.SignatureHeader),
            body,
            now);
    }

    public IReadOnlyList<EmailDeliveryEvent> Parse(ReadOnlySpan<byte> body) => ResendWebhookParser.Parse(body);

    /// <summary>
    /// What an error means for this message and the ones behind it.
    ///
    /// Resend's names are the source of truth where a status could mean two
    /// things: a 429 is a rate limit or a spent quota, a 409 is a duplicate in
    /// flight or a key reused with a different body.
    /// </summary>
    private static EmailSendResult Classify(HttpResponseMessage response, string? name, QuotaObservation? usage)
    {
        var status = (int)response.StatusCode;
        var code = string.IsNullOrWhiteSpace(name) ? $"status_{status}" : name;

        switch (response.StatusCode)
        {
            case HttpStatusCode.Unauthorized:
            case HttpStatusCode.Forbidden:
                // A key that is missing, restricted or suspended, or a domain
                // Resend will not send from. Nothing will do better until the
                // configuration changes.
                return new EmailSendResult.Refused(code, usage);

            case HttpStatusCode.TooManyRequests when name == "daily_quota_exceeded":
                return new EmailSendResult.QuotaExhausted(QuotaWindow.Daily, usage);

            case HttpStatusCode.TooManyRequests when name == "monthly_quota_exceeded":
                return new EmailSendResult.QuotaExhausted(QuotaWindow.Monthly, usage);

            case HttpStatusCode.TooManyRequests:
                return new EmailSendResult.RateLimited(RetryAfter(response) ?? TimeSpan.FromSeconds(1), usage);

            case HttpStatusCode.Conflict when name == "invalid_idempotent_request":
                // The same key with a different body. Retrying cannot help, and
                // it means this server rendered one message two ways.
                return new EmailSendResult.Permanent(code, usage);

            case HttpStatusCode.Conflict:
                // The first attempt is still in flight at Resend.
                return new EmailSendResult.Transient(code, RetryAfter(response) ?? TimeSpan.FromSeconds(1), usage);

            case HttpStatusCode.BadRequest:
            case HttpStatusCode.UnprocessableEntity:
            case HttpStatusCode.NotFound:
            case HttpStatusCode.MethodNotAllowed:
                return new EmailSendResult.Permanent(code, usage);

            default:
                return status >= 500
                    ? new EmailSendResult.Transient(code, RetryAfter(response), usage)
                    : new EmailSendResult.Permanent(code, usage);
        }
    }

    /// <summary>
    /// How much of the quota Resend says is gone, from the headers it puts on
    /// every answer — errors included. The daily one comes only on the free
    /// plan, which is the only plan with a daily cap.
    /// </summary>
    private QuotaObservation? UsageFrom(HttpResponseMessage response)
    {
        var daily = IntHeader(response, DailyQuotaHeader);
        var monthly = IntHeader(response, MonthlyQuotaHeader);

        return daily is null && monthly is null ? null : new QuotaObservation(daily, monthly, _time.GetUtcNow());
    }

    private static TimeSpan? RetryAfter(HttpResponseMessage response)
    {
        if (response.Headers.RetryAfter?.Delta is { } delta) return delta;
        if (response.Headers.RetryAfter?.Date is { } date) return date - DateTimeOffset.UtcNow;

        return IntHeader(response, "ratelimit-reset") is { } seconds ? TimeSpan.FromSeconds(seconds) : null;
    }

    private static int? IntHeader(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values)
        && int.TryParse(values.FirstOrDefault(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : null;

    private static async Task<T?> ReadAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
        where T : class
    {
        try
        {
            return await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or IOException or HttpRequestException)
        {
            return null;
        }
    }

    private sealed record SendBody(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] string[] To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("html")] string Html,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("tags")] SendTag[] Tags);

    private sealed record SendTag(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("value")] string Value);

    private sealed record SendAnswer([property: JsonPropertyName("id")] string? Id);

    private sealed record ErrorAnswer([property: JsonPropertyName("name")] string? Name);
}
