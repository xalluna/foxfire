using System.Net.Http.Headers;
using System.Net.Http.Json;
using Foxfire.Core;
using Microsoft.AspNetCore.Mvc.Testing;
using Testcontainers.Azurite;
using Testcontainers.MsSql;

namespace Foxfire.Api.Tests;

/// <summary>
/// A real Foxfire server, on a real SQL Server, for the length of a test class.
///
/// Testcontainers rather than an in-memory provider, because most of what is
/// worth asserting here is not C#. The cascade rules, the filtered indexes, the
/// conditional UPDATE that makes an invite single-use and the retrying execution
/// strategy wrapped around the registration transaction are all SQL Server
/// behaviour — an in-memory provider enforces none of it and would pass while
/// the real thing threw. The schema itself is covered too, since the server
/// applies its migrations on boot and these tests boot it.
///
/// Configuration goes in as environment variables rather than through
/// WebApplicationFactory's settings, because the server reads and validates its
/// whole configuration before the host is built — which is the behaviour being
/// relied on, not a thing to work around.
/// </summary>
public sealed class FoxfireServerFixture : IAsyncLifetime
{
    /// <summary>
    /// Pinned rather than left to the default, so CI pulls a known image and a
    /// Testcontainers upgrade cannot silently move the database these tests run
    /// against. 2022 is what docker-compose.yml ships too.
    /// </summary>
    private const string SqlServerImage = "mcr.microsoft.com/mssql/server:2022-CU14-ubuntu-22.04";

    /// <summary>
    /// Pinned for the same reason SQL Server is. Azurite is not a mock — it
    /// speaks the real Blob protocol, signs real SAS tokens and enforces them —
    /// so the replay tests exercise the code a self-hoster runs and the code
    /// somebody paying Microsoft runs, down to the signature.
    /// </summary>
    private const string AzuriteImage = "mcr.microsoft.com/azure-storage/azurite:3.35.0";

    private readonly MsSqlContainer _sql = new MsSqlBuilder(SqlServerImage).Build();
    private readonly AzuriteContainer _blob = new AzuriteBuilder(AzuriteImage).Build();
    private WebApplicationFactory<Program>? _factory;

    /// <summary>The address configured as this server's administrator.</summary>
    public const string AdminEmail = "admin@example.com";

    /// <summary>Long enough to satisfy the twelve-character floor.</summary>
    public const string GoodPassword = "a-long-enough-password";

    public const string ServerName = "Test Server";

    /// <summary>The newest desktop this server serves — what a client should claim.</summary>
    public static string CurrentDesktop => DesktopCompatibility.AllowList.Recommended;

    public async Task InitializeAsync()
    {
        await Task.WhenAll(_sql.StartAsync(), _blob.StartAsync());

        Environment.SetEnvironmentVariable("ConnectionStrings__Default", _sql.GetConnectionString());
        Environment.SetEnvironmentVariable("ConnectionStrings__Blob", _blob.GetConnectionString());
        Environment.SetEnvironmentVariable("Server__PublicUrl", "https://test.example.com");
        Environment.SetEnvironmentVariable("Server__Name", ServerName);
        Environment.SetEnvironmentVariable("Riot__ApiKey", "RGAPI-test-key-not-real");
        Environment.SetEnvironmentVariable("Riot__KeyType", "personal");
        Environment.SetEnvironmentVariable("Auth__JwtSigningKey", "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=");
        Environment.SetEnvironmentVariable("Auth__InviteSigningKey", "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg=");
        Environment.SetEnvironmentVariable("Admin__Email", AdminEmail);

        _factory = new WebApplicationFactory<Program>();

        // Force the host to build now rather than on first request, so a
        // configuration or migration failure surfaces as a fixture failure with
        // its own message instead of as every test failing at once.
        using var warmup = Client();
        await warmup.GetAsync(new Uri("/version", UriKind.Relative));
    }

    public async Task DisposeAsync()
    {
        if (_factory is not null) await _factory.DisposeAsync();
        await _sql.DisposeAsync();
        await _blob.DisposeAsync();
    }

    /// <summary>
    /// A client that claims a supported desktop version, as a real one would.
    ///
    /// Every gated route checks it, so leaving it off would make every test a
    /// test of the version gate.
    /// </summary>
    public HttpClient Client(string? desktopVersion = null)
    {
        var client = _factory!.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", desktopVersion ?? CurrentDesktop);
        return client;
    }

    /// <summary>A client with no version header at all — what something else entirely looks like.</summary>
    public HttpClient AnonymousClient() => _factory!.CreateClient();

    /// <summary>
    /// The running server's services, for tests about the database rather than
    /// about the HTTP surface.
    ///
    /// Scoped the way a request does it: resolve a DbContext from a scope and
    /// dispose the scope, never hold one across tests. Sharing the context would
    /// share its change tracker, and a test would start seeing entities another
    /// one had loaded.
    /// </summary>
    public IServiceProvider Services => _factory!.Services;

    /// <summary>
    /// The host itself, for a test that needs to replace one of its services.
    ///
    /// WithWebHostBuilder on this returns a second host sharing the same
    /// configuration and therefore the same database, but with its own
    /// singletons — which is what a sync test wants: the schema and its
    /// migrations are the real ones, and the rate limiter starts empty.
    /// </summary>
    public WebApplicationFactory<Program> Factory => _factory!;

    /// <summary>Registers somebody and returns their session.</summary>
    public async Task<Session> RegisterAsync(
        HttpClient client,
        string username,
        string email,
        string? inviteToken = null,
        string password = GoodPassword)
    {
        var response = await client.PostAsJsonAsync(
            new Uri("/auth/register", UriKind.Relative),
            new { username, email, password, inviteToken });

        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Session>())!;
    }

    /// <summary>Registers the configured admin, which is the only account that starts as one.</summary>
    public Task<Session> RegisterAdminAsync(HttpClient client) =>
        RegisterAsync(client, "TheAdmin", AdminEmail);

    /// <summary>
    /// A client signed in as the administrator, registering them if nothing has yet.
    ///
    /// The server is shared across the whole assembly, and test classes run in
    /// whatever order xUnit picks, so "has the admin registered" is not
    /// something any one test can assume. Registering and signing in are the two
    /// ways to arrive at the same session, and every test that needs an admin
    /// wants the session rather than the route taken to it.
    /// </summary>
    public async Task<(HttpClient Client, Session Session)> AdminAsync()
    {
        var client = Client();

        var login = await client.PostAsJsonAsync(
            new Uri("/auth/login", UriKind.Relative),
            new { email = AdminEmail, password = GoodPassword });

        var session = login.IsSuccessStatusCode
            ? (await login.Content.ReadFromJsonAsync<Session>())!
            : await RegisterAdminAsync(client);

        return (Authenticated(client, session), session);
    }

    /// <summary>Puts a bearer token on a client for the rest of its life.</summary>
    public static HttpClient Authenticated(HttpClient client, Session session)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", session.AccessToken);
        return client;
    }
}

/// <summary>What /auth/register and /auth/login answer with.</summary>
public sealed record Session(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt,
    SessionUser User);

public sealed record SessionUser(Guid Id, string Username, string Email, bool IsAdmin, bool EmailConfirmed);

/// <summary>An error as every endpoint reports one.</summary>
public sealed record ApiError(string Error, string Message);

/// <summary>What /version says to anybody who asks.</summary>
public sealed record VersionInfo(
    string ServerName,
    string ServerVersion,
    int ApiVersion,
    string MinimumDesktop,
    string RecommendedDesktop,
    bool PublicSignup);

/// <summary>An invite, as an admin sees it.</summary>
public sealed record InviteInfo(
    Guid Id,
    string Email,
    string Link,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RedeemedAt,
    string? RedeemedBy,
    bool IsOpen)
{
    /// <summary>The token out of the link, which is what a client actually sends.</summary>
    public string Token => Link[(Link.LastIndexOf('/') + 1)..];
}

public sealed record InvitePreview(bool Usable, string ServerName, string? Email, string Message);

public sealed record ServerSettings(bool PublicSignup, int BackfillTarget, long ReplayByteCap);

/// <summary>
/// One server for the whole assembly.
///
/// Starting SQL Server takes tens of seconds, and these tests are about the
/// contract rather than about isolation — every one of them creates its own
/// accounts and invites with unique addresses, so sharing an instance costs
/// nothing and saves minutes.
/// </summary>
[CollectionDefinition(Name)]
public sealed class FoxfireServerCollection : ICollectionFixture<FoxfireServerFixture>
{
    public const string Name = "foxfire-server";
}
