using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Features.RiotAccounts;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Foxfire.Api.Tests;

/// <summary>
/// Claiming a League account, and what arrives with it.
///
/// Separate from the RiotLinkTests in ContractTests because these need a Riot
/// that answers: the shared fixture's key is deliberately one Riot rejects, so
/// those cover the refusals and these cover a link that works.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class RiotLinkProfileTests(FoxfireServerFixture server)
{
    /// <summary>
    /// A server whose Riot answers, signed in as somebody ordinary.
    ///
    /// Its own host, because the shared fixture's key is deliberately one Riot
    /// rejects and linking's first act is a Riot lookup.
    /// </summary>
    private async Task<(WebApplicationFactory<Program> Host, HttpClient Client)> RiggedAsync(FakeRiot riot)
    {
        var host = riot.Host(server.Factory);

        using var fixtureClient = server.Client();
        var session = await server.RegisterAsync(
            fixtureClient,
            $"Linker{Guid.NewGuid().ToString("N")[..8]}",
            $"linker-{Guid.NewGuid():N}@example.com");

        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        return (host, FoxfireServerFixture.Authenticated(client, session));
    }

    [Fact]
    public async Task Linking_brings_the_profile_icon_with_it()
    {
        // Three columns nothing used to write. ProfileIconId, SummonerLevel and
        // SummonerId were on the entity, on the wire and rendered by the
        // desktop — and never populated by any path, so every account on every
        // server drew an empty frame where its icon belongs.
        //
        // Claimed rather than synced is the moment that matters: it is the one
        // time somebody is looking straight at the account, and one that turns
        // up blank reads as one that did not work.
        var puuid = $"puuid-{Guid.NewGuid():N}";
        var gameName = $"Claimed{Guid.NewGuid().ToString("N")[..8]}";

        var riot = new FakeRiot().WithAccount(gameName, "KR", puuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var response = await client.PostAsJsonAsync(
            new Uri("/api/riot-accounts/", UriKind.Relative),
            new { gameName, tagLine = "KR" });

        response.EnsureSuccessStatusCode();

        var account = await response.Content.ReadFromJsonAsync<RiotAccountResponse>();

        Assert.Equal(FakeRiot.ProfileIconFor(puuid), account?.ProfileIconId);
        Assert.Equal(312, account?.SummonerLevel);
        Assert.Equal($"summoner-{puuid}", account?.SummonerId);

        // And it is the caller's, which is the whole point of claiming one.
        Assert.True(account?.IsMine);
    }

    [Fact]
    public async Task A_claimed_account_says_so_on_the_wire()
    {
        // isMine is what the desktop gates every write on — typing LP, asking
        // for a sync. An account the caller has not claimed reports false, and
        // anybody can read it, because everything on a server is readable by
        // everybody.
        var puuid = $"puuid-{Guid.NewGuid():N}";
        var gameName = $"Shared{Guid.NewGuid().ToString("N")[..8]}";

        var riot = new FakeRiot().WithAccount(gameName, "KR", puuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var linked = await client.PostAsJsonAsync(new Uri("/api/riot-accounts/", UriKind.Relative), new { gameName, tagLine = "KR" });
        linked.EnsureSuccessStatusCode();
        var claimed = await linked.Content.ReadFromJsonAsync<RiotAccountResponse>();

        // Somebody else on the same server sees it, and sees that it is not theirs.
        using var onlooker = server.Client();
        var theirSession = await server.RegisterAsync(
            onlooker,
            $"Onlooker{Guid.NewGuid().ToString("N")[..8]}",
            $"onlooker-{Guid.NewGuid():N}@example.com");

        FoxfireServerFixture.Authenticated(onlooker, theirSession);

        var theirs = await onlooker.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{claimed!.Id}", UriKind.Relative));

        Assert.Equal(gameName, theirs.GetProperty("gameName").GetString());
        Assert.False(theirs.GetProperty("isMine").GetBoolean());
        Assert.NotNull(theirs.GetProperty("ownerUsername").GetString());
    }
}
