using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The per-address limits on signing in, searching and reading signed out, and
/// who gets to say what an address is.
///
/// Runs its own host, with limits low enough to reach in a test and a reverse
/// proxy it trusts. The in-memory test server has no network, so every request
/// here says where it came from in a header only this host reads — standing in
/// for the address a real connection would arrive from.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class RateLimitTests(FoxfireServerFixture server) : IAsyncLifetime
{
    private const int AuthLimit = 3;

    private const int ReaderLimit = 3;

    /// <summary>The one proxy this host believes.</summary>
    private const string TrustedProxy = "10.9.8.7";

    private const string RemoteAddressHeader = "X-Test-Remote-Address";

    private WebApplicationFactory<Program>? _host;

    public Task InitializeAsync()
    {
        _host = server.Factory.WithWebHostBuilder(host =>
        {
            // Added last, so these win over the fixture's environment — which
            // sets the limits high for every other test.
            host.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["RateLimit:AuthPerMinute"] = AuthLimit.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["RateLimit:ReaderPerMinute"] = ReaderLimit.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["Server:TrustedProxies"] = TrustedProxy
            }));
            host.ConfigureServices(services => services.AddTransient<IStartupFilter, RemoteAddressFromHeader>());
        });

        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        if (_host is not null) await _host.DisposeAsync();
    }

    private HttpClient From(string address, string? forwardedFor = null)
    {
        var client = _host!.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        client.DefaultRequestHeaders.Add(RemoteAddressHeader, address);
        if (forwardedFor is not null) client.DefaultRequestHeaders.Add("X-Forwarded-For", forwardedFor);
        return client;
    }

    private static Task<HttpResponseMessage> BadLoginAsync(HttpClient client) =>
        client.PostAsJsonAsync(
            new Uri("/api/auth/login", UriKind.Relative),
            new { email = "nobody@example.com", password = "not-the-password" });

    [Fact]
    public async Task Sign_ins_past_the_limit_are_turned_away_with_when_to_try_again()
    {
        using var client = From("192.0.2.10");

        for (var i = 0; i < AuthLimit; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await BadLoginAsync(client)).StatusCode);
        }

        var limited = await BadLoginAsync(client);
        var error = await limited.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("rate_limited", error?.Error);
        Assert.NotNull(limited.Headers.RetryAfter);
    }

    [Fact]
    public async Task Behind_a_trusted_proxy_each_real_address_has_its_own_allowance()
    {
        using var first = From(TrustedProxy, forwardedFor: "198.51.100.1");
        using var second = From(TrustedProxy, forwardedFor: "198.51.100.2");

        for (var i = 0; i < AuthLimit; i++) await BadLoginAsync(first);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await BadLoginAsync(first)).StatusCode);

        // Same proxy, another person behind it: not locked out by the first.
        Assert.Equal(HttpStatusCode.Unauthorized, (await BadLoginAsync(second)).StatusCode);
    }

    [Fact]
    public async Task Anybody_else_claiming_to_forward_is_not_believed()
    {
        // Otherwise a new X-Forwarded-For on every attempt would be a new
        // allowance on every attempt.
        for (var i = 0; i < AuthLimit; i++)
        {
            using var attempt = From("192.0.2.20", forwardedFor: $"203.0.113.{i + 1}");
            await BadLoginAsync(attempt);
        }

        using var another = From("192.0.2.20", forwardedFor: "203.0.113.99");
        Assert.Equal(HttpStatusCode.TooManyRequests, (await BadLoginAsync(another)).StatusCode);
    }

    [Fact]
    public async Task Refreshing_is_never_limited()
    {
        // A household behind one address reloading its tabs must not lock itself
        // out. A refresh token cannot be guessed, so there is nothing to slow.
        using var client = From("192.0.2.30");

        for (var i = 0; i < AuthLimit * 3; i++)
        {
            var response = await client.PostAsJsonAsync(
                new Uri("/api/auth/refresh", UriKind.Relative), new { refreshToken = "not-a-token" });
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }

    [Fact]
    public async Task The_handshake_is_never_limited()
    {
        using var client = From("192.0.2.40");

        for (var i = 0; i < AuthLimit * 3; i++)
        {
            var response = await client.GetAsync(new Uri("/api/version", UriKind.Relative));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }

    [Fact]
    public async Task An_outsider_reading_past_the_limit_is_turned_away_and_a_member_never_is()
    {
        // A profile shared with somebody outside, read from one address.
        var stem = Guid.NewGuid().ToString("N")[..8];
        using var member = server.Client();
        var session = await server.RegisterAsync(member, $"Limit{stem}", $"limit-{stem}@example.com");
        FoxfireServerFixture.Authenticated(member, session);

        var accountId = await TrackAsync();
        var share = await member.PostAsJsonAsync(new Uri("/api/shares", UriKind.Relative), new { riotAccountId = accountId });
        share.EnsureSuccessStatusCode();
        var token = (await share.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("token").GetString()!;

        var dashboard = new Uri($"/api/riot-accounts/{accountId}/dashboard", UriKind.Relative);

        using var outsider = From("192.0.2.50");
        outsider.DefaultRequestHeaders.Add(Auth.ShareAccess.Header, token);

        for (var i = 0; i < ReaderLimit; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await outsider.GetAsync(dashboard)).StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, (await outsider.GetAsync(dashboard)).StatusCode);

        // A member from the same address reads as much as they like — and a
        // bearer header nobody issued does not make an outsider one.
        using var signedIn = From("192.0.2.50");
        FoxfireServerFixture.Authenticated(signedIn, session);

        for (var i = 0; i < ReaderLimit * 3; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await signedIn.GetAsync(dashboard)).StatusCode);
        }

        using var pretender = From("192.0.2.50");
        pretender.DefaultRequestHeaders.Add(Auth.ShareAccess.Header, token);
        pretender.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "not-a-token");

        Assert.Equal(HttpStatusCode.TooManyRequests, (await pretender.GetAsync(dashboard)).StatusCode);
    }

    private async Task<Guid> TrackAsync()
    {
        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<Foxfire.Data.FoxfireDbContext>();
        var now = DateTimeOffset.UtcNow;

        var account = new Foxfire.Data.Entities.RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Limited{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);
        await db.SaveChangesAsync();
        return account.Id;
    }

    /// <summary>Gives a request the remote address its test header names, before the server's own pipeline runs.</summary>
    private sealed class RemoteAddressFromHeader : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((HttpContext context, RequestDelegate nextMiddleware) =>
            {
                if (IPAddress.TryParse(context.Request.Headers[RemoteAddressHeader], out var address))
                {
                    context.Connection.RemoteIpAddress = address;
                }

                return nextMiddleware(context);
            });

            next(app);
        };
    }
}
