using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Endpoints;
using Foxfire.Api.Reads;
using Foxfire.Api.Features.Import;
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
            new Uri("/api/admin/import/accounts", UriKind.Relative),
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
            new Uri("/api/admin/import/accounts", UriKind.Relative),
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
            new Uri("/api/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        // Written under the old key, exactly as a stats.db holds it.
        var payload = MatchPayloads.TenPlayerGame(matchId, T0, 420, [deadPuuid]);

        var stored = await client.PostAsJsonAsync(
            new Uri("/api/admin/import/matches", UriKind.Relative),
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
            new Uri("/api/admin/import/matches", UriKind.Relative),
            new[] { new { matchId, rawJson = payload } });

        var second = await client.PostAsJsonAsync(
            new Uri("/api/admin/import/matches", UriKind.Relative),
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
            new Uri("/api/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        var accountId = (await created.Content.ReadFromJsonAsync<List<ImportAccountResult>>())![0].AccountId!.Value;

        var response = await client.PostAsJsonAsync(
            new Uri("/api/admin/import/rank-readings", UriKind.Relative),
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
            new Uri("/api/admin/import/rank-readings", UriKind.Relative),
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

        // Not "skipped", which means the server already had it: this one has
        // nowhere to go, and a person reading the tally needs to know that.
        Assert.Equal(0, batch!.Accepted);
        Assert.Equal(0, batch.Skipped);
        Assert.Equal(1, batch.Unplaced);
    }

    [Fact]
    public async Task Readings_report_what_was_already_there_apart_from_what_had_nowhere_to_go()
    {
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Tally{Guid.NewGuid().ToString("N")[..8]}";

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));

        object[] batch = [Reading(deadPuuid, "GOLD", "II", 41, T0), Reading(UniquePuuid(), "GOLD", "II", 41, T0)];

        var first = await PostAsync<ImportBatchResult>(client, "/api/admin/import/rank-readings", batch);
        var second = await PostAsync<ImportBatchResult>(client, "/api/admin/import/rank-readings", batch);

        Assert.Equal(new ImportBatchResult(1, 0, 0, 1), first);

        // The reading that landed is now "already there"; the stranger's is
        // still homeless, and is still reported as that rather than as a repeat.
        Assert.Equal(new ImportBatchResult(0, 1, 0, 1), second);
    }

    [Fact]
    public async Task Uploading_a_newer_copy_of_the_same_file_adds_only_what_is_new()
    {
        // The scenario this whole change is for: import a file, keep using Foxfire
        // locally for a few days, import the file again. What was there must not
        // double, what is new must land, and the LP for the new games must be
        // worked out alongside the old.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Newer{Guid.NewGuid().ToString("N")[..8]}";
        var firstMatch = UniqueMatchId();
        var laterMatch = UniqueMatchId();

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        // ── The file as it was the first time ──────────────────────────────────
        var accounts = await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));
        var accountId = accounts[0].AccountId!.Value;

        // Three days back from the other constants here, so the newer copy's
        // games are recent rather than in the future.
        var earlier = T0 - 3 * 86_400_000L;

        var firstGame = new { matchId = firstMatch, rawJson = MatchPayloads.TenPlayerGame(firstMatch, earlier, 420, [deadPuuid]) };
        var readingsBefore = new[]
        {
            Reading(deadPuuid, "GOLD", "II", 41, earlier - 60_000),
            Reading(deadPuuid, "GOLD", "II", 62, earlier + 60_000)
        };

        Assert.Equal(1, (await PostAsync<ImportBatchResult>(client, "/api/admin/import/matches", new[] { firstGame })).Accepted);
        Assert.Equal(2, (await PostAsync<ImportBatchResult>(client, "/api/admin/import/rank-readings", readingsBefore)).Accepted);
        await PostAsync<ImportSummary>(client, "/api/admin/import/finish", null);

        // ── The same file, three days later ────────────────────────────────────
        var laterGame = new { matchId = laterMatch, rawJson = MatchPayloads.TenPlayerGame(laterMatch, T0, 420, [deadPuuid], win: false) };
        var readingsAfter = readingsBefore.Append(Reading(deadPuuid, "GOLD", "II", 41, T0 + 60_000)).ToArray();

        var lookupsBefore = AccountLookups(riot, gameName);

        var againAccounts = await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));

        var againMatches = await PostAsync<ImportBatchResult>(
            client, "/api/admin/import/matches", new[] { firstGame, laterGame });

        var againReadings = await PostAsync<ImportBatchResult>(
            client, "/api/admin/import/rank-readings", readingsAfter);

        var summary = await PostAsync<ImportSummary>(client, "/api/admin/import/finish", null);

        // Same account, found again without asking Riot who it is.
        Assert.Equal(accountId, againAccounts[0].AccountId);
        Assert.True(againAccounts[0].Resolved);
        Assert.Equal(lookupsBefore, AccountLookups(riot, gameName));

        Assert.Equal(new ImportBatchResult(1, 1, 0), againMatches);
        Assert.Equal(new ImportBatchResult(1, 2, 0), againReadings);
        Assert.True(summary.Attributed >= 1);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        Assert.Equal(3, await db.RankSnapshots.CountAsync(r => r.RiotAccountId == accountId));
        Assert.Equal(1, await db.Matches.CountAsync(m => m.MatchId == firstMatch));
        Assert.Equal(1, await db.Matches.CountAsync(m => m.MatchId == laterMatch));

        var first = await db.MatchRanks.AsNoTracking().FirstAsync(r => r.MatchId == firstMatch && r.RiotAccountId == accountId);
        var newest = await db.MatchRanks.AsNoTracking().FirstAsync(r => r.MatchId == laterMatch && r.RiotAccountId == accountId);

        Assert.Equal(21, first.LpDelta);
        Assert.Equal(-21, newest.LpDelta);
    }

    [Fact]
    public async Task An_account_the_server_already_knows_is_not_looked_up_again()
    {
        // A lookup is one Riot request out of a budget the whole server shares,
        // and the answer cannot have changed: the file's id already means an
        // account here. Only an account that has never resolved is worth asking
        // about — that is how a rename gets fixed by importing again.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Known{Guid.NewGuid().ToString("N")[..8]}";

        var riot = new FakeRiot().WithAccount(gameName, "NA1", livePuuid);

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var first = await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));

        Assert.Equal(1, AccountLookups(riot, gameName));

        var second = await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));

        Assert.Equal(1, AccountLookups(riot, gameName));
        Assert.True(second[0].Resolved);
        Assert.Equal(first[0].AccountId, second[0].AccountId);
    }

    [Fact]
    public async Task Unstored_matches_answers_with_only_what_the_server_lacks()
    {
        // What lets a re-upload send the new games instead of every game: ids are
        // a few bytes each and payloads are 100–200 KB, so asking first is the
        // difference between a year of history being re-sent and three days of it.
        var have = UniqueMatchId();
        var lack = UniqueMatchId();

        var (host, client) = await RiggedAsync(new FakeRiot());
        await using var _host = host;
        using var _client = client;

        await PostAsync<ImportBatchResult>(
            client,
            "/api/admin/import/matches",
            new[] { new { matchId = have, rawJson = MatchPayloads.TenPlayerGame(have, T0, 420, [UniquePuuid()]) } });

        var wanted = await PostAsync<List<string>>(
            client, "/api/admin/import/unstored-matches", new[] { have, lack });

        Assert.Equal([lack], wanted);
    }

    [Fact]
    public async Task Learning_what_a_dead_id_meant_moves_the_games_already_stored_under_it()
    {
        // The account could not be resolved the first time — the server's Riot
        // key was down, or it had been renamed — so its games went in under an id
        // that matches nothing. "Already stored" then skips them on every later
        // run, so unless the run that finally resolves the account also moves
        // them, no amount of re-uploading brings that history back.
        var deadPuuid = UniquePuuid();
        var livePuuid = UniquePuuid();
        var gameName = $"Late{Guid.NewGuid().ToString("N")[..8]}";
        var stranded = UniqueMatchId();
        var contested = UniqueMatchId();

        var riot = new FakeRiot();

        var (host, client) = await RiggedAsync(riot);
        await using var _host = host;
        using var _client = client;

        var unresolved = await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));

        Assert.False(unresolved[0].Resolved);

        await PostAsync<ImportBatchResult>(
            client,
            "/api/admin/import/matches",
            new[]
            {
                new { matchId = stranded, rawJson = MatchPayloads.TenPlayerGame(stranded, T0, 420, [deadPuuid]) },

                // Both ids in one game: moving one onto the other would collide
                // on the participant key, so this one has to be left alone
                // rather than failing the account.
                new { matchId = contested, rawJson = MatchPayloads.TenPlayerGame(contested, T0, 420, [deadPuuid, livePuuid]) }
            });

        riot.WithAccount(gameName, "NA1", livePuuid);

        var resolved = await PostAsync<List<ImportAccountResult>>(
            client, "/api/admin/import/accounts", Accounts((gameName, deadPuuid)));

        Assert.True(resolved[0].Resolved);
        Assert.Equal(1, resolved[0].HealedMatches);

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == stranded && p.Puuid == livePuuid));
        Assert.False(await db.MatchParticipants.AnyAsync(p => p.MatchId == stranded && p.Puuid == deadPuuid));

        // The copy inside the payload moved with it, or a column backfilled out
        // of it later would write the dead value straight back.
        var match = await db.Matches.AsNoTracking().FirstAsync(m => m.MatchId == stranded);
        Assert.DoesNotContain(deadPuuid, match.RawJson, StringComparison.Ordinal);
        Assert.Contains(livePuuid, match.RawJson, StringComparison.Ordinal);

        Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == contested && p.Puuid == deadPuuid));
        Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == contested && p.Puuid == livePuuid));
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
            new Uri("/api/admin/import/accounts", UriKind.Relative),
            new[] { new { gameName, tagLine = "NA1", platform = "na1", puuid = deadPuuid } });

        var accountId = (await created.Content.ReadFromJsonAsync<List<ImportAccountResult>>())![0].AccountId!.Value;

        await client.PostAsJsonAsync(
            new Uri("/api/admin/import/matches", UriKind.Relative),
            new[]
            {
                new { matchId, rawJson = MatchPayloads.TenPlayerGame(matchId, T0, 420, [deadPuuid]) }
            });

        await client.PostAsJsonAsync(
            new Uri("/api/admin/import/rank-readings", UriKind.Relative),
            new[]
            {
                Reading(deadPuuid, "GOLD", "II", 41, T0 - 60_000),
                Reading(deadPuuid, "GOLD", "II", 62, T0 + 60_000)
            });

        var finished = await client.PostAsync(new Uri("/api/admin/import/finish", UriKind.Relative), null);
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
            new Uri("/api/seasons", UriKind.Relative));

        var seeded = before!.First();
        var novel = 1_801_000_000_000L + Random.Shared.Next(1, 1_000_000);

        var response = await client.PostAsJsonAsync(
            new Uri("/api/admin/import/seasons", UriKind.Relative),
            new[]
            {
                // The same boundary the server already has, under another name.
                new { label = "Something Else Entirely", startsAt = seeded.StartsAt, isPreseason = false, resetsRank = true },
                new { label = "Imported Season", startsAt = novel, isPreseason = false, resetsRank = true }
            });

        var batch = await response.Content.ReadFromJsonAsync<ImportBatchResult>();
        Assert.Equal(1, batch!.Accepted);
        Assert.Equal(1, batch.Skipped);

        var after = await client.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/api/seasons", UriKind.Relative));
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
            new Uri("/api/admin/import/accounts", UriKind.Relative),
            Array.Empty<object>());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>A batch of accounts, in the shape a stats.db sends them.</summary>
    private static object[] Accounts(params (string GameName, string Puuid)[] accounts) =>
        [.. accounts.Select(a => new { gameName = a.GameName, tagLine = "NA1", platform = "na1", puuid = a.Puuid })];

    /// <summary>Posts a batch and reads the answer, failing the test on anything but success.</summary>
    private static async Task<T> PostAsync<T>(HttpClient client, string path, object? body)
    {
        var response = body is null
            ? await client.PostAsync(new Uri(path, UriKind.Relative), null)
            : await client.PostAsJsonAsync(new Uri(path, UriKind.Relative), body);

        response.EnsureSuccessStatusCode();

        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    /// <summary>How many times Riot was asked who a Riot ID is.</summary>
    private static int AccountLookups(FakeRiot riot, string gameName) =>
        riot.Requests.Count(r => r.Contains("/riot/account/v1/accounts/by-riot-id/", StringComparison.Ordinal)
            && r.Contains(gameName, StringComparison.Ordinal));

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
