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

    private async Task<IReadOnlyList<PlayerSearchResponse>> SearchAsync(HttpClient client, string query)
    {
        var response = await client.GetAsync(
            new Uri($"/api/search?q={Uri.EscapeDataString(query)}", UriKind.Relative));

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<IReadOnlyList<PlayerSearchResponse>>()
               ?? throw new InvalidOperationException("Search answered with no body.");
    }

    [Fact]
    public async Task A_blank_query_is_everybody_tracked_including_the_unclaimed()
    {
        var (client, session) = await server.AdminAsync();
        using var _client = client;

        var mine = await TrackAsync($"Claimed{Guid.NewGuid().ToString("N")[..8]}", ownerId: session.User.Id);
        var nobodys = await TrackAsync($"Unclaimed{Guid.NewGuid().ToString("N")[..8]}");

        var found = await SearchAsync(client, "");

        // The unclaimed one is the whole point. An account an admin added
        // belongs to nobody, and a finder that only listed claimed accounts
        // would never show it.
        Assert.Contains(found, p => p.Account.Id == mine.Id);
        Assert.Contains(found, p => p.Account.Id == nobodys.Id);
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
