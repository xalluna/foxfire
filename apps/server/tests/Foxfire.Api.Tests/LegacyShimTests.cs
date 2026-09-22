using System.Net;
using System.Net.Http.Json;

namespace Foxfire.Api.Tests;

/// <summary>
/// Desktop 0.12.0, which calls the API at the root.
///
/// It shipped before the API moved under /api, and a host upgrading their server
/// must not cut it off. It is told apart from a browser by the header every
/// desktop sends on every request — its hub included — and moved under /api
/// before routing. Each test here is a call 0.12.0 really makes, at the address
/// it really makes it.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class LegacyShimTests(FoxfireServerFixture server)
{
    private const string LegacyDesktop = "0.12.0";

    private static string Unique(string prefix) => $"{prefix}-{Guid.NewGuid():N}";

    /// <summary>A 0.12.0 desktop signed in as the admin — the session from anywhere, the calls from 0.12.0.</summary>
    private async Task<HttpClient> SignedInLegacyDesktopAsync()
    {
        var (admin, session) = await server.AdminAsync();
        admin.Dispose();
        return FoxfireServerFixture.Authenticated(server.Client(LegacyDesktop), session);
    }

    [Fact]
    public async Task Registering_and_signing_in_at_the_root_still_work()
    {
        using var desktop = server.Client(LegacyDesktop);
        var email = $"{Unique("legacy")}@example.com";

        var registered = await desktop.PostAsJsonAsync(
            new Uri("/auth/register", UriKind.Relative),
            new { username = Unique("Legacy")[..20], email, password = FoxfireServerFixture.GoodPassword });
        registered.EnsureSuccessStatusCode();

        var login = await desktop.PostAsJsonAsync(
            new Uri("/auth/login", UriKind.Relative),
            new { email, password = FoxfireServerFixture.GoodPassword });
        var session = await login.Content.ReadFromJsonAsync<Session>();

        login.EnsureSuccessStatusCode();
        Assert.NotEmpty(session?.RefreshToken ?? "");
    }

    [Fact]
    public async Task A_signed_in_read_at_the_root_still_works()
    {
        using var desktop = await SignedInLegacyDesktopAsync();

        var response = await desktop.GetAsync(new Uri("/riot-accounts", UriKind.Relative));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task The_hub_at_the_root_still_negotiates()
    {
        // 0.12.0's SignalR client negotiates at /hub/negotiate. A 404 here is
        // every live update on that desktop quietly stopping.
        using var desktop = await SignedInLegacyDesktopAsync();

        var response = await desktop.PostAsync(
            new Uri("/hub/negotiate?negotiateVersion=1", UriKind.Relative), content: null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task The_handshake_stays_where_it_is()
    {
        using var desktop = server.Client(LegacyDesktop);

        var version = await desktop.GetFromJsonAsync<VersionInfo>(new Uri("/version", UriKind.Relative));

        Assert.Equal(FoxfireServerFixture.ServerName, version?.ServerName);
    }

    [Fact]
    public async Task A_path_already_under_the_api_is_left_alone()
    {
        // Not moved to /api/api/auth/me, which would be a 404 rather than the
        // 401 an unauthenticated call deserves.
        using var desktop = server.Client();

        var response = await desktop.GetAsync(new Uri("/api/auth/me", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task The_same_address_is_the_api_for_a_desktop_and_a_page_for_a_browser()
    {
        using var desktop = server.Client(LegacyDesktop);
        using var browser = server.AnonymousClient();

        var fromDesktop = await desktop.GetAsync(new Uri("/search?gameName=Faker&tagLine=KR1", UriKind.Relative));
        var fromBrowser = await browser.GetAsync(new Uri("/search", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, fromDesktop.StatusCode);
        Assert.Equal(HttpStatusCode.OK, fromBrowser.StatusCode);
        Assert.Contains(
            FoxfireServerFixture.WebIndexMarker,
            await fromBrowser.Content.ReadAsStringAsync(),
            StringComparison.Ordinal);
    }
}
