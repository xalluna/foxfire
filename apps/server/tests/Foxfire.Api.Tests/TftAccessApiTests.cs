using System.Net.Http.Json;
using Foxfire.Api.Configuration;
using Foxfire.Api.Sync;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Whether this server can reach TFT, and which key it reaches it with.
///
/// A server whose Riot key is registered for League alone is a League server,
/// and a healthy one. It says so — at boot, in /health — and carries on; the
/// key-rejected state that stops League syncing is for a key that is actually
/// refused.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class TftAccessApiTests(FoxfireServerFixture server)
{
    private sealed record HealthInfo(string Status, bool RiotKeyRejected, int QueueDepth, string TftAccess);

    /// <summary>The boot probe runs off the request path, so this waits for it to land.</summary>
    private static async Task<HealthInfo> SettledHealthAsync(HttpClient client)
    {
        for (var i = 0; i < 50; i++)
        {
            var health = await client.GetFromJsonAsync<HealthInfo>(new Uri("/health", UriKind.Relative));
            if (health is not null && health.TftAccess != "unknown") return health;
            await Task.Delay(100);
        }

        throw new TimeoutException("The TFT probe never reported.");
    }

    [Fact]
    public async Task A_key_that_reaches_tft_says_so()
    {
        var riot = new FakeRiot();
        await using var host = riot.Host(server.Factory);
        using var client = host.CreateClient();

        var health = await SettledHealthAsync(client);

        Assert.Equal("granted", health.TftAccess);
        Assert.Equal("healthy", health.Status);
    }

    [Fact]
    public async Task A_league_only_key_is_a_healthy_league_server_without_tft()
    {
        var riot = new FakeRiot().DenyTft();
        await using var host = riot.Host(server.Factory);
        using var client = host.CreateClient();

        var health = await SettledHealthAsync(client);

        Assert.Equal("denied", health.TftAccess);
        Assert.False(health.RiotKeyRejected);
        Assert.Equal("healthy", health.Status);
        Assert.False(host.Services.GetRequiredService<Foxfire.Riot.RiotClient>().KeyRejected);
        Assert.Contains("Riot__Tft__ApiKey", host.Services.GetRequiredService<TftAccess>().Reason, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_tft_key_of_its_own_is_the_one_tft_is_called_with()
    {
        var riot = new FakeRiot();
        await using var host = riot.Host(server.Factory, tftKey: "RGAPI-tft-of-its-own");
        using var client = host.CreateClient();

        await SettledHealthAsync(client);

        Assert.True(host.Services.GetRequiredService<TftRiot>().HasOwnKey);
        Assert.All(riot.TokensFor("/tft/"), token => Assert.Equal("RGAPI-tft-of-its-own", token));
        Assert.All(riot.TokensFor("/lol/"), token => Assert.Equal("RGAPI-test-key-not-real", token));
        Assert.NotEmpty(riot.TokensFor("/tft/"));
    }

    [Fact]
    public void A_tft_key_type_is_checked_only_when_there_is_a_tft_key()
    {
        static IReadOnlyList<string> Check(TftRiotOptions tft) =>
            ConfigurationCheck.Validate(
                "Server=db;Database=Foxfire",
                new ServerOptions { PublicUrl = "https://test.example.com" },
                new RiotOptions { ApiKey = "RGAPI-test", Tft = tft },
                new AuthOptions
                {
                    JwtSigningKey = "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=",
                    InviteSigningKey = "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg="
                },
                new AdminOptions { Email = "admin@example.com" },
                new RateLimitOptions(),
                new LogOptions());

        Assert.Empty(Check(new TftRiotOptions { KeyType = "nonsense" }));
        Assert.Contains(
            Check(new TftRiotOptions { ApiKey = "RGAPI-tft", KeyType = "nonsense" }),
            problem => problem.Contains("Riot__Tft__KeyType", StringComparison.Ordinal));
        Assert.Empty(Check(new TftRiotOptions { ApiKey = "RGAPI-tft", KeyType = "application" }));
    }
}
