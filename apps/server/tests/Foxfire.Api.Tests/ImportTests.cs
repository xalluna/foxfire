using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Endpoints;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Moving a year of somebody's own Foxfire into a server.
///
/// The whole of what makes this hard is one fact, and every test here is about
/// it: Riot encrypts a player id against the key that asked for it, so every id
/// in the file being imported is a value this server's Riot will refuse. Copying
/// the rows across would produce a database that looks complete and can answer
/// nothing.
///
/// So the tests import a file whose ids are deliberately different from the ones
/// this server's key resolves to, and then check what actually happened to them:
/// in the account rows, inside the stored payloads, and on the readings that
/// have to find their way back to an account through an id nobody can decrypt.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class ImportTests(FoxfireServerFixture server)
{
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    /// <summary>
    /// A server whose Riot answers, signed in as its administrator.
    ///
    /// Its own host, so the fake key is this test's rather than the fixture's —
    /// the import's first act is a Riot lookup per account, and the shared
    /// fixture's key is deliberately one Riot rejects.
    /// </summary>
    private async Task<(WebApplicationFactory<Program> Host, HttpClient Client)> RiggedAsync(FakeRiot riot)
    {
        var host = riot.Host(server.Factory);

        // The session comes from the shared fixture and the client from this
        // host. That works because the two share a database and a JWT signing
        // key — but the request has to go to *this* host, or the import's first
        // act is a Riot lookup against the fixture's deliberately rejected key.
        var (fixtureClient, session) = await server.AdminAsync();
        fixtureClient.Dispose();

        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

        return (host, FoxfireServerFixture.Authenticated(client, session));
    }

    [Fact]
    public async Task An_imported_account_is_re_resolved_and_arrives_unclaimed()
    {
        // The file says which League accounts its owner played. It says nothing
        // about who on this server they are, and on a server that answer is
        // attested by a running League client rather than asserted by an import.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Imported{Guid.NewGuid().ToString("N")[..8]}";

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var response = await client.PostAsJsonAsync(
            new Uri("/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        response.EnsureSuccessStatusCode();

        var results = await response.Content.ReadFromJsonAsync<List<ImportAccountResult>>();
        var result = Assert.Single(results!);

        Assert.True(result.Resolved);
        Assert.NotNull(result.AccountId);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await db.RiotAccounts.AsNoTracking().FirstAsync(a => a.Id == result.AccountId);

        // The id this server's key resolves to, never the one in the file.
        Assert.Equal(livePuuid, account.Puuid);
        Assert.Null(account.OwnerId);

        // And the dead one is filed as what it used to mean, which is what every
        // later batch is translated through.
        Assert.True(await db.RetiredPuuids.AnyAsync(
            r => r.RiotAccountId == account.Id && r.Puuid == deadPuuid));
    }

    [Fact]
    public async Task A_renamed_account_is_reported_rather_than_failing_the_batch()
    {
        // A rename is a thing its owner can fix afterwards. The other nine
        // accounts in the file should not wait for it.
        var missing = $"Renamed{Guid.NewGuid().ToString("N")[..8]}";
        var present = $"Still{Guid.NewGuid().ToString("N")[..8]}";
        var livePuuid = UniquePuuid();

        var riot = new FakeRiot().WithAccount(present, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var response = await client.PostAsJsonAsync(
            new Uri("/admin/import/accounts", UriKind.Relative),
            new[]
            {
                new { gameName = missing, tagLine = "NA1", platform = "na1", puuid = UniquePuuid() },
                new { gameName = present, tagLine = "NA1", platform = "na1", puuid = UniquePuuid() }
            });

        response.EnsureSuccessStatusCode();

        var results = await response.Content.ReadFromJsonAsync<List<ImportAccountResult>>();
        Assert.Equal(2, results!.Count);

        Assert.False(results[0].Resolved);
        Assert.Contains("renamed", results[0].Message!, StringComparison.OrdinalIgnoreCase);

        Assert.True(results[1].Resolved);
    }

    [Fact]
    public async Task An_imported_match_has_its_dead_ids_rewritten_on_the_way_in()
    {
        // The payload is the same JSON Riot sent, which is why it is all the
        // import needs — but every id in it belongs to whoever's key fetched it,
        // and a participant row under a dead id matches nothing for ever.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Rewritten{Guid.NewGuid().ToString("N")[..8]}";
        var matchId = UniqueMatchId();

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        await client.PostAsJsonAsync(
            new Uri("/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        // Written under the old key, exactly as a stats.db holds it.
        var payload = MatchPayloads.TenPlayerGame(matchId, T0, 420, [deadPuuid]);

        var stored = await client.PostAsJsonAsync(
            new Uri("/admin/import/matches", UriKind.Relative),
            new[] { new { matchId, rawJson = payload } });

        stored.EnsureSuccessStatusCode();

        var batch = await stored.Content.ReadFromJsonAsync<ImportBatchResult>();
        Assert.Equal(1, batch!.Accepted);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        // The participant row is under the id this server can use.
        Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == livePuuid));
        Assert.False(await db.MatchParticipants.AnyAsync(p => p.Puuid == deadPuuid));

        // And so is the copy inside the payload, or a column backfilled out of
        // it later would write the dead value straight back.
        var match = await db.Matches.AsNoTracking().FirstAsync(m => m.MatchId == matchId);
        Assert.DoesNotContain(deadPuuid, match.RawJson, StringComparison.Ordinal);
        Assert.Contains(livePuuid, match.RawJson, StringComparison.Ordinal);

        // Strangers keep their dead ids, which is the same trade a key rotation
        // makes: no lookup goes through them, and re-resolving each would be a
        // Riot request per player per match.
        var strangers = await db.MatchParticipants.AsNoTracking()
            .CountAsync(p => p.MatchId == matchId && p.Puuid != livePuuid);

        Assert.Equal(9, strangers);
    }

    [Fact]
    public async Task Importing_the_same_match_twice_stores_it_once()
    {
        // An import interrupted halfway is resumed by running it again, so
        // re-sending a page has to be free rather than doubling anybody's
        // history.
        var matchId = UniqueMatchId();
        var payload = MatchPayloads.TenPlayerGame(matchId, T0, 420, [UniquePuuid()]);

        var (host, client) = await RiggedAsync(new FakeRiot());
        await using var _host = host;
        using var _client = client;

        var first = await client.PostAsJsonAsync(
            new Uri("/admin/import/matches", UriKind.Relative),
            new[] { new { matchId, rawJson = payload } });

        var second = await client.PostAsJsonAsync(
            new Uri("/admin/import/matches", UriKind.Relative),
            new[] { new { matchId, rawJson = payload } });

        Assert.Equal(1, (await first.Content.ReadFromJsonAsync<ImportBatchResult>())!.Accepted);
        Assert.Equal(0, (await second.Content.ReadFromJsonAsync<ImportBatchResult>())!.Accepted);
    }

    [Fact]
    public async Task Readings_find_their_account_through_the_id_that_died()
    {
        // The batch that most depends on the accounts having gone first: every
        // reading in a stats.db is keyed on a player id, and every one of those
        // is now meaningless. The retired record is the only thing that connects
        // them.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Reader{Guid.NewGuid().ToString("N")[..8]}";

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var created = await client.PostAsJsonAsync(
            new Uri("/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        var accountId = (await created.Content.ReadFromJsonAsync<List<ImportAccountResult>>())![0].AccountId!.Value;

        var response = await client.PostAsJsonAsync(
            new Uri("/admin/import/rank-readings", UriKind.Relative),
            new[]
            {
                new
                {
                    puuid = deadPuuid,
                    queueType = "RANKED_SOLO_5x5",
                    tier = "GOLD",
                    division = "II",
                    leaguePoints = 41,
                    wins = 30,
                    losses = 28,
                    source = "league_v4",
                    capturedAt = T0 - 60_000,
                    matchId = (string?)null
                }
            });

        response.EnsureSuccessStatusCode();
        Assert.Equal(1, (await response.Content.ReadFromJsonAsync<ImportBatchResult>())!.Accepted);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var reading = await db.RankSnapshots.AsNoTracking()
            .FirstAsync(r => r.RiotAccountId == accountId && r.CapturedAt == T0 - 60_000);

        Assert.Equal(RankTier.Gold, reading.Tier);

        // Recomputed rather than trusted: the source stored a position too, and
        // a stale one would plot a graph nothing else on this server agrees with.
        Assert.Equal(Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, 41)), reading.LadderPosition);
    }

    [Fact]
    public async Task A_reading_for_an_account_that_never_resolved_is_skipped()
    {
        var (host, client) = await RiggedAsync(new FakeRiot());
        await using var _host = host;
        using var _client = client;

        var response = await client.PostAsJsonAsync(
            new Uri("/admin/import/rank-readings", UriKind.Relative),
            new[]
            {
                new
                {
                    puuid = UniquePuuid(),
                    queueType = "RANKED_SOLO_5x5",
                    tier = "SILVER",
                    division = "I",
                    leaguePoints = 20,
                    wins = 1,
                    losses = 1,
                    source = "league_v4",
                    capturedAt = T0,
                    matchId = (string?)null
                }
            });

        var batch = await response.Content.ReadFromJsonAsync<ImportBatchResult>();

        Assert.Equal(0, batch!.Accepted);
        Assert.Equal(1, batch.Skipped);
    }

    [Fact]
    public async Task Finishing_works_out_the_LP_that_was_never_imported()
    {
        // Attributed rows are derived from the readings, which do come across,
        // so importing them would import a stale copy of something this server
        // can work out itself. This is where a year of history gets its numbers.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Climber{Guid.NewGuid().ToString("N")[..8]}";
        var matchId = UniqueMatchId();

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var created = await client.PostAsJsonAsync(
            new Uri("/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        var accountId = (await created.Content.ReadFromJsonAsync<List<ImportAccountResult>>())![0].AccountId!.Value;

        await client.PostAsJsonAsync(
            new Uri("/admin/import/matches", UriKind.Relative),
            new[]
            {
                new { matchId, rawJson = MatchPayloads.TenPlayerGame(matchId, T0, 420, [deadPuuid]) }
            });

        await client.PostAsJsonAsync(
            new Uri("/admin/import/rank-readings", UriKind.Relative),
            new[]
            {
                Reading(deadPuuid, "GOLD", "II", 41, T0 - 60_000),
                Reading(deadPuuid, "GOLD", "II", 62, T0 + 60_000)
            });

        var finished = await client.PostAsync(new Uri("/admin/import/finish", UriKind.Relative), null);
        finished.EnsureSuccessStatusCode();

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var attributed = await db.MatchRanks.AsNoTracking()
            .FirstOrDefaultAsync(r => r.MatchId == matchId && r.RiotAccountId == accountId);

        Assert.NotNull(attributed);
        Assert.Equal(21, attributed.LpDelta);
    }

    [Fact]
    public async Task Season_boundaries_merge_rather_than_replace()
    {
        // A server that has been running a while already has boundaries somebody
        // entered, and an import must not overwrite a correction with the copy
        // that predates it. Matched on the instant, not the name: two people
        // will have typed "Season 2026" and "2026" for the same one.
        var (host, client) = await RiggedAsync(new FakeRiot());
        await using var _host = host;
        using var _client = client;

        var before = await client.GetFromJsonAsync<List<SeasonResponse>>(
            new Uri("/seasons", UriKind.Relative));

        var seeded = before!.First();
        var novel = 1_801_000_000_000L + Random.Shared.Next(1, 1_000_000);

        var response = await client.PostAsJsonAsync(
            new Uri("/admin/import/seasons", UriKind.Relative),
            new[]
            {
                // The same boundary the server already has, under another name.
                new { label = "Something Else Entirely", startsAt = seeded.StartsAt, isPreseason = false, resetsRank = true },
                new { label = "Imported Season", startsAt = novel, isPreseason = false, resetsRank = true }
            });

        var batch = await response.Content.ReadFromJsonAsync<ImportBatchResult>();
        Assert.Equal(1, batch!.Accepted);
        Assert.Equal(1, batch.Skipped);

        var after = await client.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/seasons", UriKind.Relative));
        Assert.NotNull(after);

        // The existing one kept its name.
        Assert.Equal(seeded.Label, after!.First(s => s.StartsAt == seeded.StartsAt).Label);
        Assert.Contains(after, s => s.StartsAt == novel);
    }

    [Fact]
    public async Task Only_an_admin_can_import()
    {
        // The import writes everybody's history, and a member who mis-clicked a
        // year-old stats.db would be rewriting the community's.
        using var member = server.Client();
        var suffix = Guid.NewGuid().ToString("N")[..8];

        var session = await server.RegisterAsync(member, $"Member{suffix}", $"member-{suffix}@example.com");
        FoxfireServerFixture.Authenticated(member, session);

        var response = await member.PostAsJsonAsync(
            new Uri("/admin/import/accounts", UriKind.Relative),
            Array.Empty<object>());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    private static object Reading(string puuid, string tier, string division, int lp, long capturedAt) =>
        new
        {
            puuid,
            queueType = "RANKED_SOLO_5x5",
            tier,
            division,
            leaguePoints = lp,
            wins = (int?)null,
            losses = (int?)null,
            source = RankSources.LeagueV4,
            capturedAt,
            matchId = (string?)null
        };
}
