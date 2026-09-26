using System.Net;
using System.Text;
using System.Text.Json;
using Foxfire.Email.Resend;
using Microsoft.Extensions.Time.Testing;

namespace Foxfire.Email.Tests;

public sealed class ResendEmailProviderTests
{
    private static readonly OutboundEmail Message = new(
        Guid.Parse("0192b0c4-0000-7000-8000-000000000001"),
        "\"Foxfire\" <mail@example.com>",
        "member@example.com",
        "You're invited",
        "<p>Hello</p>",
        "Hello",
        new Dictionary<string, string> { ["kind"] = "invite" });

    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 9, 26, 12, 0, 0, TimeSpan.Zero));

    [Fact]
    public async Task A_send_carries_the_key_the_idempotency_key_and_the_message()
    {
        var stub = new Stub(_ => Answer(HttpStatusCode.OK, """{"id":"re-123"}"""));
        var provider = Provider(stub);

        var result = await provider.SendAsync(Message, CancellationToken.None);

        Assert.Equal("re-123", Assert.IsType<EmailSendResult.Accepted>(result).ProviderMessageId);

        var request = Assert.Single(stub.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://api.resend.com/emails", request.Uri);
        Assert.Equal("Bearer re_test_key", request.Authorization);
        Assert.Equal(Message.MessageId.ToString(), request.IdempotencyKey);
        Assert.False(string.IsNullOrEmpty(request.UserAgent));

        using var body = JsonDocument.Parse(request.Body);
        var root = body.RootElement;
        Assert.Equal(Message.From, root.GetProperty("from").GetString());
        Assert.Equal("member@example.com", Assert.Single(root.GetProperty("to").EnumerateArray()).GetString());
        Assert.Equal("You're invited", root.GetProperty("subject").GetString());
        Assert.Equal("<p>Hello</p>", root.GetProperty("html").GetString());
        Assert.Equal("Hello", root.GetProperty("text").GetString());

        var tag = Assert.Single(root.GetProperty("tags").EnumerateArray());
        Assert.Equal("kind", tag.GetProperty("name").GetString());
        Assert.Equal("invite", tag.GetProperty("value").GetString());
    }

    [Fact]
    public async Task The_quota_headers_are_read_as_what_has_been_used()
    {
        var stub = new Stub(_ =>
        {
            var response = Answer(HttpStatusCode.OK, """{"id":"re-1"}""");
            response.Headers.Add(ResendEmailProvider.DailyQuotaHeader, "42");
            response.Headers.Add(ResendEmailProvider.MonthlyQuotaHeader, "1200");
            return response;
        });

        var result = await Provider(stub).SendAsync(Message, CancellationToken.None);

        Assert.Equal(new QuotaObservation(42, 1200, _time.GetUtcNow()), result.Usage);
    }

    [Fact]
    public async Task The_quota_headers_are_read_off_an_error_too()
    {
        var stub = new Stub(_ =>
        {
            var response = Error(HttpStatusCode.TooManyRequests, "daily_quota_exceeded");
            response.Headers.Add(ResendEmailProvider.DailyQuotaHeader, "100");
            return response;
        });

        var result = await Provider(stub).SendAsync(Message, CancellationToken.None);

        Assert.Equal(QuotaWindow.Daily, Assert.IsType<EmailSendResult.QuotaExhausted>(result).Window);
        Assert.Equal(100, result.Usage?.DailyUsed);
        Assert.Null(result.Usage?.MonthlyUsed);
    }

    [Fact]
    public async Task A_spent_month_is_the_monthly_quota() =>
        Assert.Equal(
            QuotaWindow.Monthly,
            Assert.IsType<EmailSendResult.QuotaExhausted>(
                await Send(Error(HttpStatusCode.TooManyRequests, "monthly_quota_exceeded"))).Window);

    [Fact]
    public async Task A_rate_limit_waits_as_long_as_resend_says()
    {
        var response = Error(HttpStatusCode.TooManyRequests, "rate_limit_exceeded");
        response.Headers.Add("retry-after", "3");

        var limited = Assert.IsType<EmailSendResult.RateLimited>(await Send(response));
        Assert.Equal(TimeSpan.FromSeconds(3), limited.RetryAfter);
    }

    [Fact]
    public async Task A_rate_limit_without_a_retry_after_reads_the_reset()
    {
        var response = Error(HttpStatusCode.TooManyRequests, "rate_limit_exceeded");
        response.Headers.Add("ratelimit-reset", "2");

        Assert.Equal(TimeSpan.FromSeconds(2), Assert.IsType<EmailSendResult.RateLimited>(await Send(response)).RetryAfter);
    }

    [Fact]
    public async Task A_rate_limit_that_says_nothing_waits_a_second() =>
        Assert.Equal(
            TimeSpan.FromSeconds(1),
            Assert.IsType<EmailSendResult.RateLimited>(await Send(Error(HttpStatusCode.TooManyRequests, "rate_limit_exceeded"))).RetryAfter);

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "missing_api_key")]
    [InlineData(HttpStatusCode.Forbidden, "restricted_api_key")]
    [InlineData(HttpStatusCode.Forbidden, "validation_error")]
    public async Task A_refused_key_or_domain_is_refused(HttpStatusCode status, string name) =>
        Assert.Equal(name, Assert.IsType<EmailSendResult.Refused>(await Send(Error(status, name))).Code);

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, "validation_error")]
    [InlineData(HttpStatusCode.UnprocessableEntity, "invalid_parameter")]
    [InlineData(HttpStatusCode.Conflict, "invalid_idempotent_request")]
    public async Task A_message_that_can_never_go_is_permanent(HttpStatusCode status, string name) =>
        Assert.Equal(name, Assert.IsType<EmailSendResult.Permanent>(await Send(Error(status, name))).Code);

    [Fact]
    public async Task A_duplicate_still_in_flight_is_tried_again() =>
        Assert.IsType<EmailSendResult.Transient>(await Send(Error(HttpStatusCode.Conflict, "concurrent_idempotent_requests")));

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, "application_error")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "service_unavailable")]
    public async Task An_outage_is_transient(HttpStatusCode status, string name) =>
        Assert.Equal(name, Assert.IsType<EmailSendResult.Transient>(await Send(Error(status, name))).Code);

    [Fact]
    public async Task A_network_fault_is_transient()
    {
        var stub = new Stub(_ => throw new HttpRequestException("no route"));

        Assert.Equal(
            "network",
            Assert.IsType<EmailSendResult.Transient>(await Provider(stub).SendAsync(Message, CancellationToken.None)).Code);
    }

    [Fact]
    public async Task An_error_with_no_body_is_named_by_its_status() =>
        Assert.Equal(
            "status_502",
            Assert.IsType<EmailSendResult.Transient>(await Send(new HttpResponseMessage(HttpStatusCode.BadGateway))).Code);

    [Fact]
    public async Task An_accepted_answer_with_no_id_is_tried_again() =>
        Assert.IsType<EmailSendResult.Transient>(await Send(Answer(HttpStatusCode.OK, "{}")));

    [Fact]
    public void Its_limits_are_its_options()
    {
        var provider = new ResendEmailProvider(
            new Factory(new Stub(_ => Answer(HttpStatusCode.OK, "{}"))),
            new ResendOptions { ApiKey = "k", DailyLimit = 0, MonthlyLimit = 50_000, MonthlyResetDay = 12 },
            _time);

        Assert.Equal(new EmailLimits(0, 50_000, 12), provider.Limits);
        Assert.Equal(EmailProviders.Resend, provider.Name);
        Assert.False(provider.CanVerify);
    }

    private Task<EmailSendResult> Send(HttpResponseMessage response) =>
        Provider(new Stub(_ => response)).SendAsync(Message, CancellationToken.None);

    private ResendEmailProvider Provider(Stub stub) =>
        new(new Factory(stub), new ResendOptions { ApiKey = "re_test_key" }, _time);

    private static HttpResponseMessage Answer(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Error(HttpStatusCode status, string name) =>
        Answer(status, $$"""{"statusCode":{{(int)status}},"name":"{{name}}","message":"no"}""");

    private sealed record Seen(
        HttpMethod Method,
        string? Uri,
        string? Authorization,
        string? IdempotencyKey,
        string? UserAgent,
        string Body);

    private sealed class Stub(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public List<Seen> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(new Seen(
                request.Method,
                request.RequestUri?.ToString(),
                request.Headers.Authorization?.ToString(),
                request.Headers.TryGetValues("Idempotency-Key", out var keys) ? keys.Single() : null,
                request.Headers.UserAgent.ToString(),
                request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));

            return answer(request);
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
