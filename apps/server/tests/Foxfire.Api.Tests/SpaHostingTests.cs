using System.Net;
using System.Net.Http.Json;

namespace Foxfire.Api.Tests;

/// <summary>
/// The web client, served from the same origin as the API.
///
/// What is checked is the split between the two and the headers each side
/// carries, against a stand-in build the fixture writes — the real one is not
/// needed to test how the server serves it.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class SpaHostingTests(FoxfireServerFixture server)
{
    [Theory]
    [InlineData("/")]
    [InlineData("/players/Faker-KR1")]
    [InlineData("/players/Faker-KR1/rank?queue=flex")]
    [InlineData("/matches/KR_7123?player=Faker-KR1")]
    [InlineData("/search")]
    // Both kinds of link the server hands out. A token is two base64 halves
    // joined by a dot, which the framework's own fallback would take for a
    // missing file — so every invite and every reset link would 404.
    [InlineData("/invite/ZmF1eC1pbnZpdGU.c2lnbmF0dXJl")]
    [InlineData("/reset-password/ZmF1eC1yZXNldA.c2lnbmF0dXJl")]
    public async Task A_page_address_is_the_web_client(string path)
    {
        using var browser = server.AnonymousClient();

        var response = await browser.GetAsync(new Uri(path, UriKind.Relative));
        var html = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/html", response.Content.Headers.ContentType?.MediaType);
        Assert.Contains(FoxfireServerFixture.WebIndexMarker, html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_page_is_sent_with_its_protections_and_is_never_cached_stale()
    {
        using var browser = server.AnonymousClient();

        var response = await browser.GetAsync(new Uri("/players/Faker-KR1", UriKind.Relative));
        var headers = response.Headers;

        var csp = string.Join(" ", response.Headers.GetValues("Content-Security-Policy"));
        Assert.Contains("default-src 'self'", csp, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", csp, StringComparison.Ordinal);
        Assert.Contains("https://ddragon.leagueoflegends.com", csp, StringComparison.Ordinal);

#if FEATURE_YOUTUBE
        // A recording plays in YouTube's privacy-enhanced player, driven by its
        // IFrame API — and that is the only frame and the only foreign script.
        Assert.Contains("frame-src https://www.youtube-nocookie.com;", csp, StringComparison.Ordinal);
        Assert.Contains("script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com;", csp, StringComparison.Ordinal);
#else
        // A build without recordings lets nothing of YouTube's into the page.
        Assert.Contains("script-src 'self' 'wasm-unsafe-eval';", csp, StringComparison.Ordinal);
        Assert.DoesNotContain("youtube", csp, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("frame-src", csp, StringComparison.Ordinal);
#endif

        Assert.Equal("noindex, nofollow", string.Join(",", headers.GetValues("X-Robots-Tag")));
        Assert.Equal("same-origin", string.Join(",", headers.GetValues("Referrer-Policy")));
        Assert.Equal("nosniff", string.Join(",", headers.GetValues("X-Content-Type-Options")));
        Assert.True(headers.CacheControl?.NoCache);
    }

    [Fact]
    public async Task A_fingerprinted_asset_is_cached_for_good()
    {
        using var browser = server.AnonymousClient();

        var response = await browser.GetAsync(new Uri(FoxfireServerFixture.WebAssetPath, UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("javascript", response.Content.Headers.ContentType?.MediaType ?? "", StringComparison.Ordinal);
        Assert.Equal(TimeSpan.FromDays(365), response.Headers.CacheControl?.MaxAge);
        Assert.Contains(
            response.Headers.CacheControl?.Extensions ?? [],
            extension => extension.Name == "immutable");
    }

    [Fact]
    public async Task An_asset_that_is_not_there_is_a_404_not_the_app()
    {
        // A page asking for an asset from an older build should fail visibly,
        // not be handed index.html to parse as JavaScript.
        using var browser = server.AnonymousClient();

        var response = await browser.GetAsync(new Uri("/assets/app-old999.js", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task An_api_route_that_does_not_exist_is_a_json_404_not_a_page()
    {
        using var anyone = server.AnonymousClient();
        using var desktop = server.Client();

        foreach (var client in new[] { anyone, desktop })
        {
            var response = await client.GetAsync(new Uri("/api/nope", UriKind.Relative));
            var error = await response.Content.ReadFromJsonAsync<ApiError>();

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.Equal("not_found", error?.Error);
        }
    }

    [Fact]
    public async Task The_handshake_answers_under_the_api_too_and_says_where_the_api_is()
    {
        using var anyone = server.AnonymousClient();

        var atRoot = await anyone.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));
        var underApi = await anyone.GetFromJsonAsync<VersionInfo>(new Uri("/api/version", UriKind.Relative));

        Assert.Equal("/api", atRoot?.ApiBase);
        Assert.Equal("https://test.example.com", atRoot?.PublicUrl);
        Assert.Equal(atRoot, underApi);
    }

    [Fact]
    public async Task Only_a_page_load_gets_the_app()
    {
        using var browser = server.AnonymousClient();

        var response = await browser.PostAsync(new Uri("/players/Faker-KR1", UriKind.Relative), content: null);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
