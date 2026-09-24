using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Features.Search;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Finding somebody this server tracks.
///
/// Search used to be a live Riot lookup of any Riot ID in the world. It reads
/// the database now, so these run against the shared fixture with no Riot
/// behind it at all — which is itself the assertion worth making, since that
/// fixture's key is one Riot rejects and a search that still called out would
/// fail rather than answer.
///
/// The server is shared across the assembly, so nothing here counts rows. Every
/// test looks for the accounts it created and is indifferent to whatever else
/// other tests have left lying about.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class SearchTests(FoxfireServerFixture server)
{
    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    /// <summary>A tracked account, unclaimed unless somebody is named.</summary>
    private async Task<RiotAccount> TrackAsync(
        string gameName,
        string tagLine = "NA1",
        Guid? ownerId = null,
        (string Tier, string Division, int Lp)? solo = null)
    {
        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = UniquePuuid(),
            GameName = gameName,
            TagLine = tagLine,
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = ownerId,
            LinkedAt = ownerId is null ? null : now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        if (solo is { } standing)
        {
            db.LeagueEntries.Add(new LeagueEntry
            {
                RiotAccountId = account.Id,
                QueueType = RankedQueue.SoloDuo.RiotName(),
                Tier = RankTiers.FromRiotName(standing.Tier),
                Division = RankDivisions.FromRiotName(standing.Division),
                LeaguePoints = standing.Lp,
                Wins = 30,
                Losses = 20,
                FetchedAt = now
            });
        }

        await db.SaveChangesAsync();
        return account;
    }

    /// <summary>Many accounts sharing a stem, in one save — enough to fill pages.</summary>
    private async Task TrackManyAsync(string stem, int count)
    {
        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var now = DateTimeOffset.UtcNow;

        for (var i = 0; i < count; i++)
        {
            db.RiotAccounts.Add(new RiotAccount
            {
                Id = Guid.CreateVersion7(now),
                Puuid = UniquePuuid(),
                GameName = $"{stem}{i:D3}",
                TagLine = "NA1",
                Platform = "na1",
                RegionalRoute = "americas",
                CreatedAt = now,
                UpdatedAt = now
            });
        }

        await db.SaveChangesAsync();
    }

    private async Task<IReadOnlyList<PlayerSearchResponse>> SearchAsync(
        HttpClient client,
        string query,
        string extra = "")
    {
        var response = await client.GetAsync(
            new Uri($"/api/search?q={Uri.EscapeDataString(query)}{extra}", UriKind.Relative));

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<IReadOnlyList<PlayerSearchResponse>>()
               ?? throw new InvalidOperationException("Search answered with no body.");
    }

    [Fact]
    public async Task The_unclaimed_are_found_as_well_as_the_claimed()
    {
        var (client, session) = await server.AdminAsync();
        using var _client = client;

        var stem = Guid.NewGuid().ToString("N")[..8];
        var mine = await TrackAsync($"Claimed{stem}", ownerId: session.User.Id);
        var nobodys = await TrackAsync($"Unclaimed{stem}");

        var found = await SearchAsync(client, stem);

        // The unclaimed one is the whole point. An account an admin added
        // belongs to nobody, and a finder that only listed claimed accounts
        // would never show it.
        Assert.Contains(found, p => p.Account.Id == mine.Id);
        Assert.Contains(found, p => p.Account.Id == nobodys.Id);
    }

    [Fact]
    public async Task A_blank_query_is_a_page_rather_than_everybody()
    {
        var (client, _) = await server.AdminAsync();
        using var _client = client;

        // More than a page of accounts on the server, whatever else is here.
        await TrackManyAsync($"Crowd{Guid.NewGuid().ToString("N")[..8]}", SearchPlayersRequest.DefaultLimit + 1);

        var found = await SearchAsync(client, "");

        Assert.Equal(SearchPlayersRequest.DefaultLimit, found.Count);
    }

    [Fact]
    public async Task Pages_follow_on_from_each_other_in_name_order()
    {
        var (client, _) = await server.AdminAsync();
        using var _client = client;

        var stem = $"Pager{Guid.NewGuid().ToString("N")[..8]}";
        await TrackManyAsync(stem, 5);

        var first = await SearchAsync(client, stem, "&limit=2");
        var second = await SearchAsync(client, stem, "&limit=2&offset=2");
        var last = await SearchAsync(client, stem, "&limit=2&offset=4");

        Assert.Equal(new[] { $"{stem}000", $"{stem}001" }, first.Select(p => p.Account.GameName));
        Assert.Equal(new[] { $"{stem}002", $"{stem}003" }, second.Select(p => p.Account.GameName));

        // A short page is how a client knows there is nothing after it.
        Assert.Equal(new[] { $"{stem}004" }, last.Select(p => p.Account.GameName));
    }

    [Fact]
    public async Task No_page_is_bigger_than_the_cap_however_many_are_asked_for()
    {
        var (client, _) = await server.AdminAsync();
        using var _client = client;

        var stem = $"Greedy{Guid.NewGuid().ToString("N")[..8]}";
        await TrackManyAsync(stem, SearchPlayersRequest.MaxLimit + 1);

        var found = await SearchAsync(client, stem, "&limit=100000");

        Assert.Equal(SearchPlayersRequest.MaxLimit, found.Count);
    }

    [Fact]
    public async Task Mine_is_only_the_accounts_the_caller_has_claimed()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(
            client,
            $"Owner{Guid.NewGuid().ToString("N")[..8]}",
            $"owner-{Guid.NewGuid():N}@example.com");

        FoxfireServerFixture.Authenticated(client, session);

        var (admin, adminSession) = await server.AdminAsync();
        admin.Dispose();

        var stem = Guid.NewGuid().ToString("N")[..8];
        var mine = await TrackAsync($"Mine{stem}", ownerId: session.User.Id);
        var theirs = await TrackAsync($"Theirs{stem}", ownerId: adminSession.User.Id);
        var nobodys = await TrackAsync($"Nobodys{stem}");

        var found = await SearchAsync(client, "", "&mine=true");

        Assert.Contains(found, p => p.Account.Id == mine.Id && p.Account.IsMine);
        Assert.DoesNotContain(found, p => p.Account.Id == theirs.Id);

        // The one a null owner would have matched, had the filter compared
        // against nobody rather than against the caller.
        Assert.DoesNotContain(found, p => p.Account.Id == nobodys.Id);
    }

    [Fact]
    public async Task Claimed_is_every_account_somebody_has_linked()
    {
        var (client, session) = await server.AdminAsync();
        using var _client = client;

        var stem = Guid.NewGuid().ToString("N")[..8];
        var claimed = await TrackAsync($"Taken{stem}", ownerId: session.User.Id);
        var unclaimed = await TrackAsync($"Free{stem}");

        var found = await SearchAsync(client, stem, "&claimed=true");

        Assert.Contains(found, p => p.Account.Id == claimed.Id);
        Assert.DoesNotContain(found, p => p.Account.Id == unclaimed.Id);
    }

    [Fact]
    public async Task A_query_matches_the_name_the_tag_or_the_whole_riot_id()
    {
        using var client = server.Client();
        var session = await server.RegisterAsync(
            client,
            $"Finder{Guid.NewGuid().ToString("N")[..8]}",
            $"finder-{Guid.NewGuid():N}@example.com");

        FoxfireServerFixture.Authenticated(client, session);

        var stem = Guid.NewGuid().ToString("N")[..8];
        var account = await TrackAsync($"Zephyr{stem}", $"T{stem[..3]}");

        // Somebody typing a few letters of a name.
        Assert.Contains(await SearchAsync(client, $"zephyr{stem}"), p => p.Account.Id == account.Id);

        // Somebody who only remembers the tag.
        Assert.Contains(await SearchAsync(client, $"t{stem[..3]}"), p => p.Account.Id == account.Id);

        // Somebody pasting the whole thing out of a lobby, hash and all.
        Assert.Contains(
            await SearchAsync(client, $"Zephyr{stem}#T{stem[..3]}"),
            p => p.Account.Id == account.Id);

        // And a name nobody here has is simply absent, rather than an error or
        // a trip to Riot to ask whether it exists elsewhere.
        Assert.DoesNotContain(await SearchAsync(client, $"nobody{stem}"), p => p.Account.Id == account.Id);
    }

    [Fact]
    public async Task A_row_carries_solo_queue_rank_and_nothing_for_the_unplaced()
    {
        var (client, _) = await server.AdminAsync();
        using var _client = client;

        var stem = Guid.NewGuid().ToString("N")[..8];
        var placed = await TrackAsync($"Placed{stem}", solo: ("GOLD", "II", 47));
        var unplaced = await TrackAsync($"Unplaced{stem}");

        var found = await SearchAsync(client, stem);

        var placedRow = Assert.Single(found, p => p.Account.Id == placed.Id);
        Assert.Equal("GOLD", placedRow.SoloEntry?.Tier);
        Assert.Equal("II", placedRow.SoloEntry?.Rank);
        Assert.Equal(47, placedRow.SoloEntry?.LeaguePoints);

        // Null rather than a zeroed entry: never placed and placed at 0 LP in
        // Iron IV are different things, and the row draws nothing for the first.
        var unplacedRow = Assert.Single(found, p => p.Account.Id == unplaced.Id);
        Assert.Null(unplacedRow.SoloEntry);
    }

    [Fact]
    public async Task Searching_still_needs_somebody_signed_in()
    {
        using var client = server.Client();

        var response = await client.GetAsync(new Uri("/api/search?q=anything", UriKind.Relative));

        // Reworking what search answers was not an invitation to open it up.
        // Everything on a Foxfire server is every *member's*.
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
