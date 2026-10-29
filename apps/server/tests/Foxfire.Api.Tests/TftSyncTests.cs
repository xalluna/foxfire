using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Fetching TFT games, and everything that falls out of having them.
///
/// The same engine as <see cref="SyncTests"/> drives, through the TFT client,
/// onto TFT's tables — with the two things that differ from League pinned down:
/// a TFT game moves LP at its player's elimination rather than its lobby's end,
/// and a key with no TFT on it must never stop League.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class TftSyncTests(FoxfireServerFixture server)
{
    /// <summary>Two hours ago, inside attribution's thirty-day replay window; see SyncTests.</summary>
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    private sealed class Rig(WebApplicationFactory<Program> host) : IAsyncDisposable
    {
        public SyncService Sync => host.Services.GetRequiredService<SyncService>();

        public WebApplicationFactory<Program> Host => host;

        public AsyncServiceScope Scope() => host.Services.CreateAsyncScope();

        public async ValueTask DisposeAsync() => await host.DisposeAsync();
    }

    private Rig Start(FakeRiot riot, string? tftKey = null) => new(riot.Host(server.Factory, tftKey));

    private static async Task<RiotAccount> AddAccountAsync(FoxfireDbContext db, string puuid, Guid? ownerId = null)
    {
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = puuid,
            GameName = $"Tactician{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = ownerId,
            LinkedAt = ownerId is null ? null : now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);
        await db.SaveChangesAsync();
        return account;
    }

    private static RankSnapshot Reading(Guid accountId, string queue, long at, int lp) => new()
    {
        RiotAccountId = accountId,
        QueueType = queue,
        Tier = RankTier.Gold,
        Division = RankDivision.II,
        LeaguePoints = lp,
        LadderPosition = Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, lp)),
        Source = RankSources.Lcu,
        CapturedAt = at
    };

    [Fact]
    public async Task A_backfill_stores_every_board_and_keeps_to_its_own_sync_state()
    {
        var puuid = UniquePuuid();
        var ranked = UniqueMatchId();
        var doubleUp = UniqueMatchId();

        var riot = new FakeRiot()
            .WithTftMatchIds(puuid, ranked, doubleUp)
            .WithTftMatch(ranked, TftPayloads.Lobby(ranked, T0, 1100, [puuid]))
            .WithTftMatch(doubleUp, TftPayloads.Lobby(doubleUp, T0 - 3_600_000, 1160, ["stranger-x", "stranger-y", puuid]))
            .WithTftLeagueEntries(puuid, TftPayloads.Entries(ratedTier: "PURPLE", ratedRating: 3612));

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            accountId = (await AddAccountAsync(scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(), puuid)).Id;
        }

        var result = await rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);
        Assert.Equal(2, result.Stored);

        await using var check = rig.Scope();
        var db = check.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var games = await db.Matches.AsNoTracking().Where(m => m.MatchId == ranked || m.MatchId == doubleUp).ToListAsync();
        Assert.All(games, m => Assert.Equal(Game.Tft, m.Game));
        Assert.Equal(16, await db.TftParticipants.CountAsync(p => p.MatchId == ranked || p.MatchId == doubleUp));
        Assert.Equal(0, await db.MatchParticipants.CountAsync(p => p.MatchId == ranked));

        var mine = await db.TftParticipants.AsNoTracking().SingleAsync(p => p.MatchId == doubleUp && p.Puuid == puuid);
        Assert.Equal(3, mine.Placement);
        Assert.Equal(2, mine.TeamPlacement);
        Assert.Contains("TFT18_FloraFatalis", mine.TraitsJson, StringComparison.Ordinal);

        var states = await db.SyncStates.AsNoTracking().Where(s => s.RiotAccountId == accountId).ToListAsync();
        var tft = Assert.Single(states);
        Assert.Equal(Game.Tft, tft.Game);
        Assert.True(tft.BackfillComplete);
        Assert.Equal(ranked, tft.MostRecentMatchId);

        var entries = await db.LeagueEntries.AsNoTracking().Where(l => l.RiotAccountId == accountId).ToListAsync();
        Assert.Contains(entries, e => e.QueueType == "RANKED_TFT" && e.Tier == RankTier.Platinum);
        Assert.Contains(entries, e => e.QueueType == "RANKED_TFT_TURBO" && e.RatedTier == RatedTier.Purple && e.RatedRating == 3612);

        // The League engine was never asked for anything.
        Assert.DoesNotContain(riot.Requests, r => r.StartsWith("/lol/match", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Lp_is_placed_at_the_players_elimination_not_the_lobbys_end()
    {
        // Knocked out 1,700 s in, the lobby playing on to 2,216 s. A reading
        // taken between the two is after this player's game — it is where the
        // LP moved — and placed at the lobby's end the game would sit after it,
        // with nothing left in the interval to hand the LP to.
        var puuid = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithTftMatchIds(puuid, matchId)
            .WithTftMatch(matchId, TftPayloads.Lobby(matchId, T0, 1100, ["winner", "second", "third", puuid]));

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;

            // Fourth place: the lobby's length less three steps of 150.25 s.
            var eliminated = T0 + (long)((2216.4 - (3 * 150.25)) * 1000);
            db.RankSnapshots.Add(Reading(accountId, "RANKED_TFT", T0 - 60_000, 40));
            db.RankSnapshots.Add(Reading(accountId, "RANKED_TFT", eliminated + 60_000, 62));
            await db.SaveChangesAsync();
        }

        await rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);

        await using var check = rig.Scope();
        var rank = await check.ServiceProvider.GetRequiredService<FoxfireDbContext>().MatchRanks
            .AsNoTracking()
            .SingleAsync(r => r.MatchId == matchId && r.RiotAccountId == accountId);

        Assert.Equal(22, rank.LpDelta);
        Assert.Equal("RANKED_TFT", rank.QueueType);
    }

    [Fact]
    public async Task Hyper_roll_is_worth_its_change_in_rating()
    {
        var puuid = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithTftMatchIds(puuid, matchId)
            .WithTftMatch(matchId, TftPayloads.Lobby(matchId, T0, 1130, [puuid], gameLength: 1500));

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, puuid)).Id;

            foreach (var (at, tier, rating) in new[] { (T0 - 60_000, RatedTier.Blue, 3360), (T0 + 1_600_000, RatedTier.Purple, 3412) })
            {
                db.RankSnapshots.Add(new RankSnapshot
                {
                    RiotAccountId = accountId,
                    QueueType = "RANKED_TFT_TURBO",
                    RatedTier = tier,
                    RatedRating = rating,
                    LadderPosition = rating,
                    Source = RankSources.Lcu,
                    CapturedAt = at
                });
            }

            await db.SaveChangesAsync();
        }

        await rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);

        await using var check = rig.Scope();
        var rank = await check.ServiceProvider.GetRequiredService<FoxfireDbContext>().MatchRanks
            .AsNoTracking()
            .SingleAsync(r => r.MatchId == matchId && r.RiotAccountId == accountId);

        Assert.Equal(52, rank.LpDelta);
        Assert.True(rank.IsPromotion);
        Assert.Equal(RatedTier.Purple, rank.RatedTierAfter);
    }

    [Fact]
    public async Task A_key_with_no_tft_syncs_no_tft_and_league_carries_on()
    {
        var puuid = UniquePuuid();
        var lolMatch = UniqueMatchId();

        var riot = new FakeRiot()
            .DenyTft()
            .WithMatchIds(puuid, lolMatch)
            .WithMatch(lolMatch, MatchPayloads.TenPlayerGame(lolMatch, T0, 420, [puuid]));

        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            accountId = (await AddAccountAsync(scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(), puuid)).Id;
        }

        // Refused by Riot, or — when the boot probe got there first — by the
        // server, which already knows. Either way no TFT, and no failed sync:
        // a League-only server is a healthy one.
        var tft = await rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);
        Assert.Equal(new SyncResult(0, 0), tft);

        var access = rig.Host.Services.GetRequiredService<TftAccess>();
        Assert.Equal(TftAccessState.Denied, access.State);
        Assert.False(rig.Host.Services.GetRequiredService<RiotClient>().KeyRejected);

        // Inside ten minutes a second TFT sync does not ask Riot again.
        var tftCalls = riot.Requests.Count(r => r.StartsWith("/tft/match", StringComparison.Ordinal));
        Assert.Equal(new SyncResult(0, 0), await rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual));
        Assert.Equal(tftCalls, riot.Requests.Count(r => r.StartsWith("/tft/match", StringComparison.Ordinal)));

        var league = await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);
        Assert.Equal(1, league.Stored);
    }

    [Fact]
    public async Task A_tft_key_of_its_own_files_tft_under_its_own_puuid()
    {
        var mainPuuid = UniquePuuid();
        var tftPuuid = UniquePuuid();
        var matchId = UniqueMatchId();

        var riot = new FakeRiot()
            .WithTftMatchIds(tftPuuid, matchId)
            .WithTftMatch(matchId, TftPayloads.Lobby(matchId, T0, 1100, [tftPuuid]));

        await using var rig = Start(riot, tftKey: "RGAPI-tft-own");

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            var account = await AddAccountAsync(scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(), mainPuuid);
            accountId = account.Id;
            riot.WithAccount(account.GameName, account.TagLine, tftPuuid);
        }

        var result = await rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);
        Assert.Equal(1, result.Stored);

        await using var check = rig.Scope();
        var db = check.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var scoped = await db.ScopedPuuids.AsNoTracking().SingleAsync(s => s.RiotAccountId == accountId);
        Assert.Equal(tftPuuid, scoped.Puuid);
        Assert.True(await db.TftParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == tftPuuid));
        Assert.Equal(mainPuuid, (await db.RiotAccounts.AsNoTracking().SingleAsync(a => a.Id == accountId)).Puuid);

        Assert.All(riot.TokensFor("/tft/match"), token => Assert.Equal("RGAPI-tft-own", token));
        Assert.All(riot.TokensFor("/riot/account"), token => Assert.Equal("RGAPI-tft-own", token));
    }

    [Fact]
    public async Task Each_game_syncs_on_its_own_and_joins_only_its_own_run()
    {
        var puuid = UniquePuuid();
        var riot = new FakeRiot();
        await using var rig = Start(riot);

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            accountId = (await AddAccountAsync(scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(), puuid)).Id;
        }

        var tft = rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);
        var lol = rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);
        var tftAgain = rig.Sync.SyncAsync(accountId, Game.Tft, SyncTrigger.Manual);

        await Task.WhenAll(tft, lol, tftAgain);

        await using var check = rig.Scope();
        var states = await check.ServiceProvider.GetRequiredService<FoxfireDbContext>().SyncStates
            .AsNoTracking()
            .Where(s => s.RiotAccountId == accountId)
            .ToListAsync();

        Assert.Equal([Game.Lol, Game.Tft], states.Select(s => s.Game).Order());
        Assert.Single(riot.Requests, r => r.StartsWith("/tft/match/v1/matches/by-puuid", StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_game_ended_from_an_older_desktop_watches_league_and_a_named_one_watches_its_game()
    {
        var riot = new FakeRiot();
        await using var rig = Start(riot);
        var (admin, session) = await server.AdminAsync();
        admin.Dispose();

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            accountId = (await AddAccountAsync(
                scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(), UniquePuuid(), session.User.Id)).Id;
        }

        using var client = rig.Host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        FoxfireServerFixture.Authenticated(client, session);

        var scheduler = rig.Host.Services.GetRequiredService<PostGameSyncScheduler>();

        var old = await client.PostAsJsonAsync(new Uri("/api/sync/game-ended", UriKind.Relative), new { riotAccountId = accountId });
        Assert.Equal(HttpStatusCode.Accepted, old.StatusCode);
        Assert.True(scheduler.IsScheduled(accountId, Game.Lol));
        Assert.False(scheduler.IsScheduled(accountId, Game.Tft));

        var named = await client.PostAsJsonAsync(
            new Uri("/api/sync/game-ended", UriKind.Relative), new { riotAccountId = accountId, game = "tft" });
        Assert.Equal(HttpStatusCode.Accepted, named.StatusCode);
        Assert.True(scheduler.IsScheduled(accountId, Game.Tft));

        var unknown = await client.PostAsJsonAsync(
            new Uri("/api/sync/game-ended", UriKind.Relative), new { riotAccountId = accountId, game = "valorant" });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);

        var state = await client.GetFromJsonAsync<System.Text.Json.JsonElement>(
            new Uri($"/api/sync/{accountId}?game=tft", UriKind.Relative));
        Assert.Equal("tft", state.GetProperty("game").GetString());
    }

    [Fact]
    public async Task A_tft_reading_from_the_client_is_taken_and_a_mismatched_game_is_refused()
    {
        var riot = new FakeRiot();
        await using var rig = Start(riot);
        var (admin, session) = await server.AdminAsync();
        admin.Dispose();

        Guid accountId;
        await using (var scope = rig.Scope())
        {
            accountId = (await AddAccountAsync(
                scope.ServiceProvider.GetRequiredService<FoxfireDbContext>(), UniquePuuid(), session.User.Id)).Id;
        }

        using var client = rig.Host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);
        FoxfireServerFixture.Authenticated(client, session);

        var rated = await client.PostAsJsonAsync(new Uri("/api/rank-readings", UriKind.Relative), new
        {
            riotAccountId = accountId,
            queueType = "RANKED_TFT_TURBO",
            ratedTier = "BLUE",
            ratedRating = 2810,
            force = false,
            game = "tft"
        });
        rated.EnsureSuccessStatusCode();

        var mismatched = await client.PostAsJsonAsync(new Uri("/api/rank-readings", UriKind.Relative), new
        {
            riotAccountId = accountId,
            queueType = "RANKED_SOLO_5x5",
            tier = "GOLD",
            division = "II",
            leaguePoints = 50,
            force = false,
            game = "tft"
        });
        Assert.Equal(HttpStatusCode.BadRequest, mismatched.StatusCode);

        await using var check = rig.Scope();
        var reading = await check.ServiceProvider.GetRequiredService<FoxfireDbContext>().RankSnapshots
            .AsNoTracking()
            .SingleAsync(r => r.RiotAccountId == accountId);

        Assert.Equal(RatedTier.Blue, reading.RatedTier);
        Assert.Equal(2810, reading.LadderPosition);
    }

    [Fact]
    public async Task A_tft_sync_queues_one_for_the_other_members_in_a_lobby_it_stored()
    {
        // League's rule on TFT's tables: the other member's own TFT sync, which
        // fetches the game they played on their own, and no League sync at all.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var earlier = UniqueMatchId();
        var theirEarlier = UniqueMatchId();
        var since = UniqueMatchId();
        var shared = UniqueMatchId();

        var riot = new FakeRiot()
            .WithTftMatchIds(mine, earlier)
            .WithTftMatchIds(theirs, theirEarlier)
            .WithTftMatch(earlier, TftPayloads.Lobby(earlier, T0 - 7_200_000, 1100, [mine]))
            .WithTftMatch(theirEarlier, TftPayloads.Lobby(theirEarlier, T0 - 7_200_000, 1100, [theirs]))
            .WithTftMatch(since, TftPayloads.Lobby(since, T0 - 3_600_000, 1100, [theirs]))
            .WithTftMatch(shared, TftPayloads.Lobby(shared, T0, 1100, [mine, theirs]));

        await using var rig = Start(riot);

        Guid myId, theirId;
        await using (var scope = rig.Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            myId = (await AddAccountAsync(db, mine)).Id;
            theirId = (await AddAccountAsync(db, theirs)).Id;
        }

        await rig.Sync.SyncAsync(myId, Game.Tft, SyncTrigger.Manual);
        await rig.Sync.SyncAsync(theirId, Game.Tft, SyncTrigger.Manual);

        riot.WithTftMatchIds(mine, shared, earlier).WithTftMatchIds(theirs, shared, since, theirEarlier);
        Assert.Equal(1, (await rig.Sync.SyncAsync(myId, Game.Tft, SyncTrigger.Auto)).Stored);

        // Under way before the sync that started it returned, so once it is not,
        // it is over.
        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(20);
        while (rig.Sync.IsSyncing(theirId, Game.Tft))
        {
            Assert.True(DateTimeOffset.UtcNow < deadline, "their TFT sync never finished");
            await Task.Delay(25);
        }

        Assert.Equal(1, riot.MatchFetchCount(since));
        Assert.Equal(1, riot.MatchFetchCount(shared));

        await using var check = rig.Scope();
        var checkDb = check.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        Assert.True(await checkDb.TftParticipants.AnyAsync(p => p.MatchId == since && p.Puuid == theirs));

        var states = await checkDb.SyncStates.AsNoTracking().Where(s => s.RiotAccountId == theirId).ToListAsync();
        var tft = Assert.Single(states);
        Assert.Equal(Game.Tft, tft.Game);
        Assert.Equal(shared, tft.MostRecentMatchId);
    }
}
