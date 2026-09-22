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
/// The per-address limits on signing in and searching, and who gets to say what
/// an address is.
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
