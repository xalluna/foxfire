using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace Foxfire.Api.Tests;

/// <summary>
/// The web client's half of the contract: how it is admitted, and how its
/// session is kept.
///
/// The session is the part worth being careful about. A browser gets its
/// refresh token as a cookie no script can read, rotated on every refresh, and
/// the server's reuse detection has to work through the cookie exactly as it
/// does through a desktop's body — presenting a spent token ends every session.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class WebClientTests(FoxfireServerFixture server)
{
    private const string CookieName = "foxfire_refresh";

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    private static Uri Api(string path) => new(path, UriKind.Relative);

    private static async Task<HttpResponseMessage> RegisterAsync(HttpClient client)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var response = await client.PostAsJsonAsync(
            Api("/api/auth/register"),
            new { username = $"Web{suffix}", email = $"web-{suffix}@example.com", password = FoxfireServerFixture.GoodPassword });

        response.EnsureSuccessStatusCode();
        return response;
    }

    /// <summary>The refresh cookie a response set, as its raw Set-Cookie line.</summary>
    private static string RefreshCookie(HttpResponseMessage response)
    {
        Assert.True(response.Headers.TryGetValues("Set-Cookie", out var cookies), "No Set-Cookie header.");
        return Assert.Single(cookies, c => c.StartsWith($"{CookieName}=", StringComparison.Ordinal));
    }

    private static string CookieValue(string setCookie) =>
        setCookie[(CookieName.Length + 1)..setCookie.IndexOf(';', StringComparison.Ordinal)];

    [Fact]
    public async Task A_page_built_against_a_served_api_version_is_admitted()
    {
        using var web = server.WebClient();

        var response = await web.GetAsync(Api("/api/auth/me"));

        // Past the gate: turned away for having no token, not for what it is.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_page_left_open_across_an_upgrade_is_told_to_reload()
    {
        using var stale = server.WebClient(apiVersion: 99);

        var response = await stale.GetAsync(Api("/api/auth/me"));
        var error = await response.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.UpgradeRequired, response.StatusCode);
        Assert.Equal("unsupported_client", error?.Error);
        Assert.Contains("Reload", error?.Message ?? "", StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_page_that_does_not_say_its_api_version_is_turned_away()
    {
        using var client = server.AnonymousClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", "web");

        var response = await client.GetAsync(Api("/api/auth/me"));

        Assert.Equal(HttpStatusCode.UpgradeRequired, response.StatusCode);
    }

    [Fact]
    public async Task The_refresh_token_arrives_as_a_cookie_no_script_can_read_and_not_in_the_body()
    {
        using var web = server.WebClient();

        var response = await RegisterAsync(web);
        var body = await response.Content.ReadAsStringAsync();
        var cookie = RefreshCookie(response);

        using var json = JsonDocument.Parse(body);
        Assert.False(json.RootElement.TryGetProperty("refreshToken", out _));
        Assert.True(json.RootElement.TryGetProperty("accessToken", out _));

        Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("expires=", cookie, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_refresh_reads_the_cookie_and_rotates_it()
    {
        using var web = server.WebClient();
        var first = CookieValue(RefreshCookie(await RegisterAsync(web)));

        var refreshed = await web.PostAsync(Api("/api/auth/refresh"), content: null);
        var session = await refreshed.Content.ReadFromJsonAsync<WebSession>();

        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        Assert.NotEmpty(session?.AccessToken ?? "");
        Assert.NotEqual(first, CookieValue(RefreshCookie(refreshed)));

        // And the new access token works.
        web.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session!.AccessToken);
        var me = await web.GetAsync(Api("/api/auth/me"));
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);
    }

    [Fact]
    public async Task Presenting_a_spent_cookie_ends_the_session_it_came_from()
    {
        // The reuse detection a desktop has, through the cookie: a refresh token
        // presented twice means two parties hold it, and the server ends the
        // whole chain rather than guessing which one is the owner.
        using var web = server.WebClient();
        var spent = CookieValue(RefreshCookie(await RegisterAsync(web)));

        var rotated = await web.PostAsync(Api("/api/auth/refresh"), content: null);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);

        using var thief = server.WebClient();
        using var replay = new HttpRequestMessage(HttpMethod.Post, Api("/api/auth/refresh"));
        replay.Headers.Add("Cookie", $"{CookieName}={spent}");
        var replayed = await thief.SendAsync(replay);
        Assert.Equal(HttpStatusCode.Unauthorized, replayed.StatusCode);

        // The owner's current cookie went with it.
        var owner = await web.PostAsync(Api("/api/auth/refresh"), content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, owner.StatusCode);
    }

    [Fact]
    public async Task Signing_out_drops_the_cookie_and_ends_the_session()
    {
        using var web = server.WebClient();
        await RegisterAsync(web);

        var signedOut = await web.PostAsync(Api("/api/auth/logout"), content: null);
        Assert.Equal(HttpStatusCode.NoContent, signedOut.StatusCode);

        // Deleted by expiring it, which is the only way a server can.
        var cleared = RefreshCookie(signedOut);
        Assert.Contains("expires=Thu, 01 Jan 1970", cleared, StringComparison.OrdinalIgnoreCase);

        var refresh = await web.PostAsync(Api("/api/auth/refresh"), content: null);
        Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
    }

    [Fact]
    public async Task A_desktop_still_gets_its_refresh_token_in_the_body_and_no_cookie()
    {
        using var desktop = server.Client();

        var session = await server.RegisterAsync(desktop, "Deskbound", $"{Unique("desk")}@example.com");

        Assert.NotEmpty(session.RefreshToken);

        var refreshed = await desktop.PostAsJsonAsync(
            Api("/api/auth/refresh"), new { refreshToken = session.RefreshToken });
        var next = await refreshed.Content.ReadFromJsonAsync<Session>();

        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        Assert.NotEmpty(next?.RefreshToken ?? "");
        Assert.False(refreshed.Headers.Contains("Set-Cookie"));
    }

    [Fact]
    public async Task The_hub_admits_a_page_that_names_itself_in_the_query()
    {
        // A browser cannot put a header on a WebSocket, so the web client names
        // itself in the hub's query string — for the negotiate call as well, since
        // the SignalR client sends the same URL for both.
        using var web = server.WebClient();
        var session = await (await RegisterAsync(web)).Content.ReadFromJsonAsync<WebSession>();

        using var anonymous = server.AnonymousClient();
        anonymous.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session!.AccessToken);

        var named = await anonymous.PostAsync(
            Api("/api/hub/negotiate?negotiateVersion=1&client=web&apiVersion=1"), content: null);
        var stale = await anonymous.PostAsync(
            Api("/api/hub/negotiate?negotiateVersion=1&client=web&apiVersion=99"), content: null);
        var unnamed = await anonymous.PostAsync(Api("/api/hub/negotiate?negotiateVersion=1"), content: null);

        Assert.Equal(HttpStatusCode.OK, named.StatusCode);
        Assert.Equal(HttpStatusCode.UpgradeRequired, stale.StatusCode);
        Assert.Equal(HttpStatusCode.UpgradeRequired, unnamed.StatusCode);
    }
}
