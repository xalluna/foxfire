using System.Net;

namespace Foxfire.Riot.Tests;

/// <summary>
/// A 403 from TFT on a key that is fine for League.
///
/// Riot ties a key to a product, so a key registered for League alone gets a
/// 403 from every TFT endpoint — the same status an expired key gets. Read as a
/// rejection it would latch the shared queue, and a League-only server would
/// stop syncing League the first time somebody opened a TFT page.
/// </summary>
public sealed class TftAccessTests
{
    private static readonly RiotRateLimits Roomy = new(
        BurstLimit: 1_000,
        BurstWindow: TimeSpan.FromSeconds(1),
        SustainedLimit: 1_000,
        SustainedWindow: TimeSpan.FromSeconds(10),
        RetryBackoff: TimeSpan.Zero);

    private static HttpResponseMessage Status(HttpStatusCode code, string body = "{}") =>
        new(code) { Content = new StringContent(body) };

    [Fact]
    public async Task A_tft_403_on_the_main_key_fails_the_call_and_leaves_the_queue_running()
    {
        using var limiter = new RiotRateLimiter(Roomy);
        var handler = new ByPath(path => path.StartsWith("/tft/", StringComparison.Ordinal)
            ? Status(HttpStatusCode.Forbidden)
            : Status(HttpStatusCode.OK, """{"puuid":"p-1","gameName":"Ahri","tagLine":"EUW"}"""));

        var tft = new RiotClient(new Factory(handler), limiter, "RGAPI-main", tftForbiddenMeansNoAccess: true);

        var refused = await Assert.ThrowsAsync<RiotApiException>(
            () => tft.GetTftMatchIdsAsync("americas", "p-1", 0, 20, RiotRequestPriority.Backfill));

        Assert.True(refused.NoProductAccess);
        Assert.False(refused.IsKeyRejection);
        Assert.False(limiter.KeyRejected);

        // League, on the same key and the same queue, carries on.
        var account = await tft.GetAccountByRiotIdAsync("americas", "Ahri", "EUW");
        Assert.Equal("p-1", account.Puuid);

        Assert.False(await tft.ValidateTftAccessAsync());
        Assert.False(limiter.KeyRejected);
    }

    [Fact]
    public async Task A_403_from_league_on_the_same_client_is_still_a_rejected_key()
    {
        using var limiter = new RiotRateLimiter(Roomy);
        var tft = new RiotClient(
            new Factory(new ByPath(_ => Status(HttpStatusCode.Forbidden))), limiter, "RGAPI-main",
            tftForbiddenMeansNoAccess: true);

        var refused = await Assert.ThrowsAsync<RiotApiException>(
            () => tft.GetAccountByRiotIdAsync("americas", "Ahri", "EUW"));

        Assert.True(refused.IsKeyRejection);
        Assert.True(limiter.KeyRejected);
    }

    [Fact]
    public async Task A_tft_key_of_its_own_that_is_refused_latches_its_own_queue_alone()
    {
        using var main = new RiotRateLimiter(Roomy);
        using var own = new RiotRateLimiter(Roomy);
        var handler = new ByPath(_ => Status(HttpStatusCode.Forbidden));

        var tft = new RiotClient(new Factory(handler), own, "RGAPI-tft");

        var refused = await Assert.ThrowsAsync<RiotApiException>(
            () => tft.GetTftLeagueEntriesAsync("na1", "p-1", RiotRequestPriority.Interactive));

        Assert.True(refused.IsKeyRejection);
        Assert.True(own.KeyRejected);
        Assert.False(main.KeyRejected);
    }

    [Fact]
    public async Task A_bad_minute_at_riot_is_no_answer_about_access()
    {
        using var limiter = new RiotRateLimiter(Roomy with { RetryBackoff = TimeSpan.Zero });
        var tft = new RiotClient(
            new Factory(new ByPath(_ => Status(HttpStatusCode.ServiceUnavailable))), limiter, "RGAPI-main",
            tftForbiddenMeansNoAccess: true);

        Assert.Null(await tft.ValidateTftAccessAsync());
    }

    [Fact]
    public async Task A_tft_match_with_nobody_placed_is_refused_where_it_arrived()
    {
        using var limiter = new RiotRateLimiter(Roomy);
        var tft = new RiotClient(
            new Factory(new ByPath(_ => Status(
                HttpStatusCode.OK,
                """{"metadata":{"match_id":"NA1_1","participants":["p"]},"info":{"game_datetime":1,"game_length":1,"participants":[{"puuid":"p","placement":0}]}}"""))),
            limiter,
            "RGAPI-main");

        await Assert.ThrowsAsync<RiotApiException>(
            () => tft.GetTftMatchAsync("americas", "NA1_1", RiotRequestPriority.Backfill));
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class ByPath(Func<string, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(respond(request.RequestUri!.AbsolutePath));
    }
}
