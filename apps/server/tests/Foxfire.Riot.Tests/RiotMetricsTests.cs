using System.Diagnostics.Metrics;
using System.Net;

namespace Foxfire.Riot.Tests;

/// <summary>
/// What the Riot client says about each call, on its meter.
///
/// Through a real client and a real limiter, with Riot stubbed at the handler,
/// because what matters is where the measurement is taken: once per attempt,
/// with the endpoint's template rather than its path, and with the queue's wait
/// kept apart from Riot's own time.
/// </summary>
public sealed class RiotMetricsTests
{
    private static readonly RiotRateLimits Roomy = new(
        BurstLimit: 1_000,
        BurstWindow: TimeSpan.FromSeconds(1),
        SustainedLimit: 1_000,
        SustainedWindow: TimeSpan.FromSeconds(10),
        RetryBackoff: TimeSpan.Zero);

    [Theory]
    [InlineData(200, "ok")]
    [InlineData(204, "ok")]
    [InlineData(404, "not_found")]
    [InlineData(429, "throttled")]
    [InlineData(401, "key_rejected")]
    [InlineData(403, "key_rejected")]
    [InlineData(400, "client_error")]
    [InlineData(503, "server_error")]
    public void Statuses_are_grouped_by_what_a_host_would_do_about_them(int status, string outcome) =>
        Assert.Equal(outcome, RiotMetrics.Outcome(status));

    [Fact]
    public async Task Every_attempt_is_measured_and_the_wait_once()
    {
        using var meters = new TestMeterFactory();
        using var recorded = new Recorded(meters);

        // A 429 that asks for no wait, then the answer.
        var responses = new Queue<HttpResponseMessage>(
        [
            new HttpResponseMessage(HttpStatusCode.TooManyRequests) { Headers = { { "Retry-After", "0" } } },
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("""{"puuid":"p-1","gameName":"Ahri","tagLine":"EUW"}""")
            }
        ]);

        using var limiter = new RiotRateLimiter(Roomy);
        var client = new RiotClient(
            new StubFactory(new StubHandler(responses)),
            limiter,
            "RGAPI-test",
            metrics: new RiotMetrics(meters));

        var account = await client.GetAccountByRiotIdAsync("europe", "Ahri", "EUW");

        Assert.Equal("p-1", account.Puuid);

        var requests = recorded.Of(RiotMetrics.RequestDuration);
        Assert.Equal(["throttled", "ok"], requests.Select(r => r.Tags["outcome"]));
        Assert.All(requests, r =>
        {
            Assert.Equal("/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}", r.Tags["endpoint"]);
            Assert.Equal("interactive", r.Tags["priority"]);
        });

        Assert.Single(recorded.Of(RiotMetrics.QueueWait));
    }

    [Fact]
    public async Task A_client_with_no_meter_still_answers()
    {
        var responses = new Queue<HttpResponseMessage>([new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"puuid":"p-2"}""")
        }]);

        using var limiter = new RiotRateLimiter(Roomy);
        var client = new RiotClient(new StubFactory(new StubHandler(responses)), limiter, "RGAPI-test");

        Assert.Equal("p-2", (await client.GetAccountByRiotIdAsync("europe", "A", "B")).Puuid);
    }

    private sealed record Measurement(string Instrument, double Value, IReadOnlyDictionary<string, object?> Tags);

    /// <summary>Everything published on meters from one factory, and nothing from anybody else's.</summary>
    private sealed class Recorded : IDisposable
    {
        private readonly MeterListener _listener = new();
        private readonly List<Measurement> _seen = [];

        public Recorded(IMeterFactory scope)
        {
            _listener.InstrumentPublished = (instrument, listener) =>
            {
                if (ReferenceEquals(instrument.Meter.Scope, scope)) listener.EnableMeasurementEvents(instrument);
            };

            _listener.SetMeasurementEventCallback<double>((instrument, value, tags, _) =>
            {
                var named = new Dictionary<string, object?>();
                foreach (var tag in tags) named[tag.Key] = tag.Value;
                lock (_seen) _seen.Add(new Measurement(instrument.Name, value, named));
            });

            _listener.Start();
        }

        public List<Measurement> Of(string instrument)
        {
            lock (_seen) return [.. _seen.Where(m => m.Instrument == instrument)];
        }

        public void Dispose() => _listener.Dispose();
    }

    private sealed class TestMeterFactory : IMeterFactory
    {
        private readonly List<Meter> _meters = [];

        public Meter Create(MeterOptions options)
        {
            var meter = new Meter(options.Name, options.Version, options.Tags, scope: this);
            _meters.Add(meter);
            return meter;
        }

        public void Dispose()
        {
            foreach (var meter in _meters) meter.Dispose();
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class StubHandler(Queue<HttpResponseMessage> responses) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            lock (responses) return Task.FromResult(responses.Dequeue());
        }
    }
}
