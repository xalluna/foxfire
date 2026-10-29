using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Fetching games and everything that falls out of having them.
///
/// Driven through the real sync engine against a real SQL Server, with only the
/// socket replaced. That combination is the point: match ingestion is a
/// projection into a schema with composite keys and cascades, deduplication is a
/// race between two members, and re-keying is four statements in a transaction —
/// none of those are provable against an in-memory provider, and none are
/// provable against a faked RiotClient either.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class SyncTests(FoxfireServerFixture server)
{
    /// <summary>
    /// Two hours ago, not a fixed instant.
    ///
    /// A routine attribution replay only reaches back thirty days, so games
    /// dated to a literal would drop out of the window as soon as the literal
    /// aged — the suite would pass for a month and then start failing for a
    /// reason having nothing to do with the code. Every offset below stays
    /// inside the two hours, so nothing is dated into the future either.
    /// </summary>
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    private static async Task<RiotAccount> AddAccountAsync(FoxfireDbContext db, string? puuid = null)
    {
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = puuid ?? UniquePuuid(),
            GameName = $"Player{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);
        await db.SaveChangesAsync();
        return account;
    }

    /// <summary>The server, with this Riot behind it and a scope to inspect it through.</summary>
    private sealed class Rig(WebApplicationFactory<Program> host) : IAsyncDisposable
    {
        public SyncService Sync => host.Services.GetRequiredService<SyncService>();

        public PostGameSyncScheduler Ladders => host.Services.GetRequiredService<PostGameSyncScheduler>();

        public AsyncServiceScope Scope() => host.Services.CreateAsyncScope();

        public async ValueTask DisposeAsync() => await host.DisposeAsync();
    }

    private Rig Start(FakeRiot riot) => new(riot.Host(server.Factory));

    [Fact]
    public async Task A_backfill_stores_every_match_and_marks_itself_done()
    {
        var puuid = UniquePuuid();
        var ids = new[] { UniqueMatchId(), UniqueMatchId(), UniqueMatchId() };

        var riot = new FakeRiot().WithMatchIds(puuid, ids);
        for (var i = 0; i < ids.Length; i++)
        {
            riot.WithMatch(ids[i], MatchPayloads.TenPlayerGame(ids[i], T0 + i * 1_000_000, 420, [puuid]));
        }

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;
        }

        var result = await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        Assert.Equal(3, result.Stored);
        Assert.Equal(0, result.Failed);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            var stored = await db.Matches.Where(m => ids.Contains(m.MatchId)).CountAsync();
            Assert.Equal(3, stored);

            // Ten rows per match, not one. The other nine are what makes a
            // second member's sync free.
            var participants = await db.MatchParticipants.Where(p => ids.Contains(p.MatchId)).CountAsync();
            Assert.Equal(30, participants);

            var state = await db.SyncStates.FirstAsync(s => s.RiotAccountId == accountId);
            Assert.True(state.BackfillComplete);
            Assert.Equal(ids[0], state.MostRecentMatchId);
        }
    }

    [Fact]
    public async Task The_projection_matches_what_Riot_sent()
    {
        var puuid = UniquePuuid();
        var matchId = UniqueMatchId();
        var payload = MatchPayloads.TenPlayerGame(matchId, T0, 420, [puuid]);

        var riot = new FakeRiot().WithMatchIds(puuid, matchId).WithMatch(matchId, payload);
        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;
        }

        await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            var match = await db.Matches.AsNoTracking().FirstAsync(m => m.MatchId == matchId);
            Assert.Equal(T0, match.GameCreation);
            Assert.Equal(420, match.QueueId);
            Assert.Equal("CLASSIC", match.GameMode);

            // Verbatim, not re-serialised. A future column gets backfilled out of
            // this, so what is stored has to be what arrived.
            Assert.Equal(payload, match.RawJson);

            var mine = await db.MatchParticipants.AsNoTracking()
                .FirstAsync(p => p.MatchId == matchId && p.Puuid == puuid);

            // Minions and monsters summed on the way in, the way the renderer
            // expects to read it.
            Assert.Equal(200, mine.Cs);
            Assert.Equal([3153, 3006, 6672, 3031, 3072, 0, 3363], mine.Items);
            Assert.False(mine.GameEndedInEarlySurrender);
            Assert.NotNull(mine.PerksJson);
            Assert.Contains("statPerks", mine.PerksJson);
        }
    }

    [Fact]
    public async Task A_game_two_members_played_is_fetched_once()
    {
        // The whole storage argument for a shared server, asserted as a request
        // count rather than as a row count: the second person's history is
        // already here, and finding that out has to be free.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(mine, matchId)
            .WithMatchIds(theirs, matchId)
            .WithMatch(matchId, MatchPayloads.TenPlayerGame(matchId, T0, 420, [mine, theirs]));

        await using var rig = Start(riot);

        Guid first, second;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            first = (await AddAccountAsync(db, mine)).Id;
            second = (await AddAccountAsync(db, theirs)).Id;
        }

        var one = await rig.Sync.SyncAsync(first, SyncTrigger.Manual);
        var two = await rig.Sync.SyncAsync(second, SyncTrigger.Manual);

        Assert.Equal(1, one.Stored);
        Assert.Equal(0, two.Stored);
        Assert.Equal(1, riot.MatchFetchCount(matchId));

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            // Both are in it, from the one payload.
            Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == mine));
            Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == theirs));
        }
    }

    [Fact]
    public async Task A_delta_sync_stops_at_the_newest_match_it_already_has()
    {
        var puuid = UniquePuuid();
        var old = UniqueMatchId();
        var fresh = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(puuid, old)
            .WithMatch(old, MatchPayloads.TenPlayerGame(old, T0, 420, [puuid]))
            .WithMatch(fresh, MatchPayloads.TenPlayerGame(fresh, T0 + 3_600_000, 420, [puuid]));

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;
        }

        await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        // A newer game appears, and the marker is what keeps the second run from
        // walking the whole history again.
        riot.WithMatchIds(puuid, fresh, old);

        var delta = await rig.Sync.SyncAsync(accountId, SyncTrigger.Auto);

        Assert.Equal(1, delta.Stored);
        Assert.Equal(1, riot.MatchFetchCount(old));

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var state = await db.SyncStates.AsNoTracking().FirstAsync(s => s.RiotAccountId == accountId);
            Assert.Equal(fresh, state.MostRecentMatchId);
        }
    }

    [Fact]
    public async Task A_puuid_Riot_cannot_decrypt_is_re_resolved_and_the_history_moves_with_it()
    {
        // What every stored puuid looks like the moment the host replaces the
        // server's API key. Nothing is lost; the account has to be introduced
        // again, and the Riot ID is what survives to do it with.
        var dead = UniquePuuid();
        var live = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(live, matchId)
            .WithMatch(matchId, MatchPayloads.TenPlayerGame(matchId, T0, 420, [live]));

        await using var rig = Start(riot);

        Guid accountId;
        string riotId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var account = await AddAccountAsync(db, dead);
            accountId = account.Id;
            riotId = account.RiotId;

            // History recorded under the old puuid, including inside the payload.
            db.Matches.Add(new Match
            {
                MatchId = matchId,
                GameCreation = T0,
                GameDuration = 1669,
                QueueId = 420,
                PlatformId = "NA1",
                RawJson = MatchPayloads.TenPlayerGame(matchId, T0, 420, [dead]),
                FetchedAt = DateTimeOffset.UtcNow
            });

            db.MatchParticipants.Add(new MatchParticipant
            {
                MatchId = matchId,
                Puuid = dead,
                TeamId = 100,
                ChampionId = 1
            });

            await db.SaveChangesAsync();
        }

        riot.WithDeadPuuid(dead)
            .WithAccount(riotId.Split('#')[0], "NA1", live);

        await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            var account = await db.RiotAccounts.AsNoTracking().FirstAsync(a => a.Id == accountId);
            Assert.Equal(live, account.Puuid);

            // The participant row moved rather than being duplicated.
            Assert.False(await db.MatchParticipants.AnyAsync(p => p.Puuid == dead));
            Assert.True(await db.MatchParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == live));

            // And so did the copy inside the payload, so a future backfill out of
            // it cannot write the dead value back.
            var match = await db.Matches.AsNoTracking().FirstAsync(m => m.MatchId == matchId);
            Assert.DoesNotContain(dead, match.RawJson, StringComparison.Ordinal);
            Assert.Contains(live, match.RawJson, StringComparison.Ordinal);

            // Kept as a record, so a puuid turning up in an old log can still be
            // attributed to the account it belonged to.
            Assert.True(await db.RetiredPuuids.AnyAsync(r => r.RiotAccountId == accountId && r.Puuid == dead));
        }
    }

    [Fact]
    public async Task A_rename_is_reported_rather_than_guessed_at()
    {
        // Riot has no record of the Riot ID any more, which is what a rename
        // looks like from here. Deleting rows because a lookup missed would be a
        // poor trade for a problem one re-link solves.
        var dead = UniquePuuid();
        var riot = new FakeRiot().WithDeadPuuid(dead);

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, dead)).Id;
        }

        var failure = await Assert.ThrowsAsync<InvalidOperationException>(
            () => rig.Sync.SyncAsync(accountId, SyncTrigger.Manual));

        Assert.Contains("no longer knows", failure.Message, StringComparison.Ordinal);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var account = await db.RiotAccounts.AsNoTracking().FirstAsync(a => a.Id == accountId);

            // Unchanged. Nothing was retired on the strength of a missed lookup.
            Assert.Equal(dead, account.Puuid);
            Assert.False(await db.RetiredPuuids.AnyAsync(r => r.RiotAccountId == accountId));
        }
    }

    [Fact]
    public async Task A_sync_takes_a_rank_reading_and_attributes_the_game_between_two()
    {
        // The end-to-end shape of LP: a reading before, one game, a reading
        // after, and a row that says what the game was worth. Both readings are
        // observed rather than typed, and the second is the one this sync takes.
        var puuid = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(puuid, matchId)
            .WithMatch(matchId, MatchPayloads.TenPlayerGame(matchId, T0, 420, [puuid]))
            .WithLeagueEntries(
                puuid,
                """
                [{"queueType":"RANKED_SOLO_5x5","tier":"GOLD","rank":"II","leaguePoints":62,"wins":31,"losses":28}]
                """);

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var account = await AddAccountAsync(db, puuid);
            accountId = account.Id;

            // Where they stood before the game, recorded by a League client that
            // was running at the time.
            db.RankSnapshots.Add(new RankSnapshot
            {
                RiotAccountId = accountId,
                QueueType = RankedQueue.SoloDuo.RiotName(),
                Tier = RankTier.Gold,
                Division = RankDivision.II,
                LeaguePoints = 41,
                LadderPosition = Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, 41)),
                Source = RankSources.Lcu,
                CapturedAt = T0 - 60_000
            });

            await db.SaveChangesAsync();
        }

        await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

            var attributed = await db.MatchRanks.AsNoTracking()
                .FirstOrDefaultAsync(r => r.MatchId == matchId && r.RiotAccountId == accountId);

            Assert.NotNull(attributed);
            Assert.Equal(21, attributed.LpDelta);
            Assert.Equal(RankTier.Gold, attributed.TierAfter);
            Assert.Equal(62, attributed.LpAfter);
            Assert.False(attributed.IsPromotion);

            // And the current standing was upserted alongside the history.
            var entry = await db.LeagueEntries.AsNoTracking()
                .FirstAsync(l => l.RiotAccountId == accountId && l.QueueType == "RANKED_SOLO_5x5");

            Assert.Equal(62, entry.LeaguePoints);
            Assert.Equal(31, entry.Wins);
        }
    }

    [Fact]
    public async Task Two_ranked_games_in_one_interval_are_left_alone()
    {
        // The rule that makes the number trustworthy: the total could have been
        // split any number of ways, so nothing is written rather than a guess
        // presented as a measurement.
        var puuid = UniquePuuid();
        var first = UniqueMatchId();
        var second = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(puuid, second, first)
            .WithMatch(first, MatchPayloads.TenPlayerGame(first, T0, 420, [puuid]))
            .WithMatch(second, MatchPayloads.TenPlayerGame(second, T0 + 1_800_000, 420, [puuid]))
            .WithLeagueEntries(
                puuid,
                """
                [{"queueType":"RANKED_SOLO_5x5","tier":"GOLD","rank":"II","leaguePoints":62}]
                """);

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;

            db.RankSnapshots.Add(new RankSnapshot
            {
                RiotAccountId = accountId,
                QueueType = RankedQueue.SoloDuo.RiotName(),
                Tier = RankTier.Gold,
                Division = RankDivision.II,
                LeaguePoints = 41,
                LadderPosition = Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, 41)),
                Source = RankSources.Lcu,
                CapturedAt = T0 - 60_000
            });

            await db.SaveChangesAsync();
        }

        await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            Assert.False(await db.MatchRanks.AnyAsync(r => r.RiotAccountId == accountId));
        }
    }

    /// <summary>Where somebody stood on the solo ladder, as a League client reported it.</summary>
    private static RankSnapshot GoldII(Guid riotAccountId, int lp, long capturedAt) => new()
    {
        RiotAccountId = riotAccountId,
        QueueType = RankedQueue.SoloDuo.RiotName(),
        Tier = RankTier.Gold,
        Division = RankDivision.II,
        LeaguePoints = lp,
        LadderPosition = Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, lp)),
        Source = RankSources.Lcu,
        CapturedAt = capturedAt
    };

    private static int LeagueReads(FakeRiot riot, string puuid) =>
        riot.Requests.Count(r => r.Contains($"/league/v4/entries/by-puuid/{puuid}", StringComparison.Ordinal));

    private static int MatchListReads(FakeRiot riot, string puuid) =>
        riot.Requests.Count(r => r.StartsWith($"/lol/match/v5/matches/by-puuid/{puuid}/ids", StringComparison.Ordinal));

    private const string TheirGoldII62 =
        """
        [{"queueType":"RANKED_SOLO_5x5","tier":"GOLD","rank":"II","leaguePoints":62,"wins":31,"losses":28}]
        """;

    /// <summary>
    /// Waits for an account's sync to finish — one somebody else's sync started,
    /// which runs on its own and is nobody's to await. It is under way before the
    /// sync that started it returns, so once it is not, it is over.
    /// </summary>
    private static async Task SettledAsync(Rig rig, Guid riotAccountId)
    {
        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(20);

        while (rig.Sync.IsSyncing(riotAccountId))
        {
            if (DateTimeOffset.UtcNow > deadline) throw new TimeoutException($"{riotAccountId} was still syncing");
            await Task.Delay(25);
        }
    }

    /// <summary>
    /// Two members, a game only the first had before, and one they then queued
    /// into together — so the first's next sync is a delta that finds it, the
    /// shape of the post-game sync one client asked for. The second has synced
    /// before, and has played <paramref name="theirsSince"/> since, on their own.
    /// </summary>
    private static async Task<(Guid Mine, Guid Theirs)> SyncASharedGameAsync(
        Rig rig,
        FakeRiot riot,
        string mine,
        string theirs,
        string shared,
        string[] theirsSince,
        Action<FoxfireDbContext, Guid>? seedTheirs = null)
    {
        var earlier = UniqueMatchId();
        var theirEarlier = UniqueMatchId();

        riot.WithMatchIds(mine, earlier)
            .WithMatchIds(theirs, theirEarlier)
            .WithMatch(earlier, MatchPayloads.TenPlayerGame(earlier, T0 - 5_400_000, 420, [mine]))
            .WithMatch(theirEarlier, MatchPayloads.TenPlayerGame(theirEarlier, T0 - 5_400_000, 420, [theirs]))
            .WithMatch(shared, MatchPayloads.TenPlayerGame(shared, T0, 420, [mine, theirs]));

        // Newest first, the way Riot lists them, and all of them before the
        // shared game.
        for (var i = 0; i < theirsSince.Length; i++)
        {
            riot.WithMatch(
                theirsSince[i],
                MatchPayloads.TenPlayerGame(theirsSince[i], T0 - ((i + 1) * 1_200_000), 420, [theirs]));
        }

        Guid myId, theirId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            myId = (await AddAccountAsync(db, mine)).Id;
            theirId = (await AddAccountAsync(db, theirs)).Id;
            await db.SaveChangesAsync();
        }

        // Each one's first sync, a backfill, which finds nobody else.
        await rig.Sync.SyncAsync(myId, SyncTrigger.Manual);
        await rig.Sync.SyncAsync(theirId, SyncTrigger.Manual);

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            seedTheirs?.Invoke(db, theirId);
            await db.SaveChangesAsync();
        }

        // Ranked from here on, so the only reading after the seeded one is what
        // the shared game's sync led to.
        riot.WithMatchIds(mine, shared, earlier)
            .WithMatchIds(theirs, [shared, .. theirsSince, theirEarlier])
            .WithLeagueEntries(theirs, TheirGoldII62);

        await rig.Sync.SyncAsync(myId, SyncTrigger.Auto);

        return (myId, theirId);
    }

    [Fact]
    public async Task A_sync_queues_one_for_the_other_members_in_a_game_it_stored()
    {
        // Alluna and Yoshi queue together, and only Alluna's client reports the
        // game. Yoshi's history gains it from the same payload — but Yoshi has
        // played three games since his last sync, and nothing fetched those. A
        // rank reading taken for him on the spot closed the stretch since his
        // last one with only the shared game in it, which handed it the LP of
        // all four.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var shared = UniqueMatchId();
        string[] since = [UniqueMatchId(), UniqueMatchId(), UniqueMatchId()];
        var riot = new FakeRiot();

        await using var rig = Start(riot);
        var (_, theirId) = await SyncASharedGameAsync(
            rig, riot, mine, theirs, shared, since, (db, id) => db.RankSnapshots.Add(GoldII(id, 41, T0 - 3_700_000)));

        await SettledAsync(rig, theirId);

        // Their own sync, not a reading: the list asked for again, the games they
        // played on their own fetched, the shared one not fetched a second time.
        Assert.Equal(2, MatchListReads(riot, theirs));
        Assert.All(since, id => Assert.Equal(1, riot.MatchFetchCount(id)));
        Assert.Equal(1, riot.MatchFetchCount(shared));

        await using var scope = rig.Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        Assert.Equal(3, await db.MatchParticipants.CountAsync(p => since.Contains(p.MatchId) && p.Puuid == theirs));

        var state = await db.SyncStates.AsNoTracking().FirstAsync(s => s.RiotAccountId == theirId && s.Game == Game.Lol);
        Assert.Equal(shared, state.MostRecentMatchId);

        // Read once the games were in, so the stretch holds all four and is
        // left alone rather than put on the one that happened to be shared.
        Assert.False(await db.MatchRanks.AnyAsync(r => r.RiotAccountId == theirId));

        var entry = await db.LeagueEntries.AsNoTracking()
            .FirstAsync(l => l.RiotAccountId == theirId && l.QueueType == "RANKED_SOLO_5x5");
        Assert.Equal(62, entry.LeaguePoints);
    }

    [Fact]
    public async Task A_member_with_nothing_else_new_gets_the_shared_game_attributed()
    {
        // The shared game was the only one they played, so the stretch from the
        // reading before it to the one their sync took holds exactly it.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var shared = UniqueMatchId();
        var riot = new FakeRiot();

        await using var rig = Start(riot);
        var (_, theirId) = await SyncASharedGameAsync(
            rig, riot, mine, theirs, shared, [], (db, id) => db.RankSnapshots.Add(GoldII(id, 41, T0 - 60_000)));

        await SettledAsync(rig, theirId);

        await using var scope = rig.Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var attributed = await db.MatchRanks.AsNoTracking()
            .SingleAsync(r => r.RiotAccountId == theirId);

        Assert.Equal(shared, attributed.MatchId);
        Assert.Equal(21, attributed.LpDelta);
    }

    [Fact]
    public async Task A_member_whose_own_ladder_is_waiting_is_left_to_it()
    {
        // Their own client said their game ended, so their own post-game ladder
        // is already going to sync them. A second run beside it would spend the
        // same requests twice.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var riot = new FakeRiot();

        await using var rig = Start(riot);
        var ladders = rig.Ladders;

        var (_, theirId) = await SyncASharedGameAsync(
            rig, riot, mine, theirs, UniqueMatchId(), [UniqueMatchId()], (_, id) => ladders.Schedule(id));

        Assert.True(ladders.IsScheduled(theirId));
        Assert.False(rig.Sync.IsSyncing(theirId));
        Assert.Equal(1, MatchListReads(riot, theirs));
    }

    [Fact]
    public async Task A_backfill_syncs_nobody_else()
    {
        // A backfill is history. Finding somebody in a game from months ago says
        // nothing about whether they have played since, and a new member's first
        // sync would otherwise sync everybody they ever queued with.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var shared = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(mine, shared)
            .WithMatch(shared, MatchPayloads.TenPlayerGame(shared, T0, 420, [mine, theirs]))
            .WithLeagueEntries(theirs, TheirGoldII62);

        await using var rig = Start(riot);

        Guid myId, theirId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            myId = (await AddAccountAsync(db, mine)).Id;
            theirId = (await AddAccountAsync(db, theirs)).Id;
        }

        Assert.Equal(1, (await rig.Sync.SyncAsync(myId, SyncTrigger.Manual)).Stored);

        // A sync it had started would be under way still, or would have made
        // their sync state by now.
        Assert.False(rig.Sync.IsSyncing(theirId));
        Assert.Equal(0, MatchListReads(riot, theirs));
        Assert.Equal(0, LeagueReads(riot, theirs));

        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            Assert.False(await db.SyncStates.AnyAsync(s => s.RiotAccountId == theirId));
        }
    }

    [Fact]
    public async Task A_rank_reading_that_has_not_moved_is_not_recorded_twice()
    {
        // The series is walked in adjacent pairs, so a row identical to the one
        // before it adds an interval that can never be attributed and splits one
        // that could have been.
        await using var rig = Start(new FakeRiot());

        await using var scope = rig.Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var recorder = scope.ServiceProvider.GetRequiredService<RankRecorder>();

        var account = await AddAccountAsync(db);
        var reading = new RankReadingInput(
            "RANKED_SOLO_5x5", RankTier.Silver, RankDivision.I, 88, 10, 9);

        Assert.True(await recorder.RecordAsync(account.Id, reading, RankSources.Lcu, T0));
        await db.SaveChangesAsync();

        Assert.False(await recorder.RecordAsync(account.Id, reading, RankSources.Lcu, T0 + 60_000));

        // A game that moved no LP still happened, and without a reading either
        // side of it the game before and the game after share one interval.
        Assert.True(await recorder.RecordAsync(account.Id, reading, RankSources.Lcu, T0 + 120_000, force: true));
        await db.SaveChangesAsync();

        var count = await db.RankSnapshots.CountAsync(r => r.RiotAccountId == account.Id);
        Assert.Equal(2, count);
    }

    [Fact]
    public async Task A_second_caller_joins_the_run_already_under_way()
    {
        // Two people in the same game both signal its end. The second caller gets
        // the first run's result, which is the honest answer to whether anything
        // landed — and, more to the point, does not spend the community's Riot
        // budget proving it twice.
        var puuid = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(puuid, matchId)
            .WithMatch(matchId, MatchPayloads.TenPlayerGame(matchId, T0, 420, [puuid]));

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;
        }

        var both = await Task.WhenAll(
            rig.Sync.SyncAsync(accountId, SyncTrigger.Manual),
            rig.Sync.SyncAsync(accountId, SyncTrigger.Auto));

        Assert.Equal(both[0], both[1]);
        Assert.Equal(1, riot.MatchFetchCount(matchId));
    }
}
