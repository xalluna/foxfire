using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;

namespace Foxfire.Api.Tests;

/// <summary>
/// The post-game ladder, on a clock the test moves.
///
/// What is worth proving about it is how often it asks Riot, so each test gives
/// a ladder every minute it could want and counts the id lists it fetched. The
/// ladder is the server's own, moved onto a fake clock and nothing else, so
/// anything in the server that asks whether one is waiting sees it.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class PostGameLadderTests(FoxfireServerFixture server)
{
    /// <summary>Two hours ago, inside attribution's thirty-day replay window; see SyncTests.</summary>
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private static string UniquePuuid() => $"puuid-{Guid.NewGuid():N}";

    private sealed class Rig(WebApplicationFactory<Program> host, FakeTimeProvider clock) : IAsyncDisposable
    {
        public FakeTimeProvider Clock => clock;

        public SyncService Sync => host.Services.GetRequiredService<SyncService>();

        public PostGameSyncScheduler Ladders => host.Services.GetRequiredService<PostGameSyncScheduler>();

        public AsyncServiceScope Scope() => host.Services.CreateAsyncScope();

        public async ValueTask DisposeAsync() => await host.DisposeAsync();
    }

    private Rig Start(FakeRiot riot)
    {
        var clock = new FakeTimeProvider(DateTimeOffset.UtcNow);

        var host = riot.Host(server.Factory).WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
                services.AddSingleton(sp => new PostGameSyncScheduler(
                    sp.GetRequiredService<SyncService>(),
                    clock,
                    sp.GetRequiredService<ILogger<PostGameSyncScheduler>>()))));

        return new Rig(host, clock);
    }

    private static async Task<Guid> AddAccountAsync(Rig rig, string puuid)
    {
        await using var scope = rig.Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = puuid,
            GameName = $"Player{Guid.NewGuid().ToString("N")[..8]}",
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

    /// <summary>How many times an account's id list was fetched: the first request of every attempt.</summary>
    private static int IdListReads(FakeRiot riot, Game game, string puuid)
    {
        var prefix = game == Game.Tft ? "/tft/match/v1/matches/by-puuid/" : "/lol/match/v5/matches/by-puuid/";
        return riot.Requests.Count(r => r.StartsWith($"{prefix}{puuid}/ids", StringComparison.Ordinal));
    }

    /// <summary>
    /// Gives a ladder every minute it asks for, and waits for it to finish.
    ///
    /// The clock moves a step at a time rather than once, because an attempt
    /// sets its next delay only when its sync is done: a single jump could land
    /// before the ladder had anything waiting on it, and leave it waiting forever.
    /// </summary>
    private static async Task RunOutAsync(Rig rig, Guid accountId, Game game)
    {
        var step = game.PostGameRetryDelays().Max();
        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(30);

        while (rig.Ladders.IsScheduled(accountId, game))
        {
            Assert.True(DateTimeOffset.UtcNow < deadline, "The ladder was still waiting after every attempt it had.");
            rig.Clock.Advance(step);
            await Task.Delay(20);
        }
    }

    /// <summary>
    /// Moves the clock until a League ladder's first attempt has asked Riot and
    /// finished — in steps short enough that it cannot run on into the second,
    /// which is set only once the first is done, and a minute and a half after it.
    /// </summary>
    private static async Task FirstAttemptAsync(Rig rig, FakeRiot riot, Guid accountId, string puuid)
    {
        var before = IdListReads(riot, Game.Lol, puuid);
        var deadline = DateTimeOffset.UtcNow + TimeSpan.FromSeconds(30);

        while (IdListReads(riot, Game.Lol, puuid) == before || rig.Sync.IsSyncing(accountId))
        {
            Assert.True(DateTimeOffset.UtcNow < deadline, "The ladder never made its first attempt.");
            rig.Clock.Advance(TimeSpan.FromSeconds(10));
            await Task.Delay(20);
        }
    }

    [Fact]
    public async Task A_ladder_whose_game_another_member_stored_makes_no_further_attempts()
    {
        // Two members queue together and both clients say the game ended. The
        // first ladder to find the match stores it for both of them; the
        // second's sync then finds it already here and stores nothing, which
        // used to read as "not yet" — four more attempts, three requests each.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var earlier = UniqueMatchId();
        var shared = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(mine, earlier)
            .WithMatchIds(theirs, earlier)
            .WithMatch(earlier, MatchPayloads.TenPlayerGame(earlier, T0 - 3_600_000, 420, [mine, theirs]))
            .WithMatch(shared, MatchPayloads.TenPlayerGame(shared, T0, 420, [mine, theirs]));

        await using var rig = Start(riot);
        var myId = await AddAccountAsync(rig, mine);
        var theirId = await AddAccountAsync(rig, theirs);

        await rig.Sync.SyncAsync(myId, SyncTrigger.Manual);
        await rig.Sync.SyncAsync(theirId, SyncTrigger.Manual);

        // Their client says the game ended; Riot publishes it, and my sync gets
        // there first.
        rig.Ladders.Schedule(theirId);
        riot.WithMatchIds(mine, shared, earlier).WithMatchIds(theirs, shared, earlier);
        Assert.Equal(1, (await rig.Sync.SyncAsync(myId, SyncTrigger.Auto)).Stored);

        var listed = IdListReads(riot, Game.Lol, theirs);
        await RunOutAsync(rig, theirId, Game.Lol);

        // One attempt, to learn the game was in already, and none after it.
        Assert.Equal(listed + 1, IdListReads(riot, Game.Lol, theirs));
        Assert.Equal(1, riot.MatchFetchCount(shared));
        Assert.Equal(shared, await rig.Sync.MostRecentMatchIdAsync(theirId, Game.Lol));
    }

    [Fact]
    public async Task A_ladder_ends_without_asking_once_sync_now_has_found_its_game()
    {
        // Pressed between two attempts by somebody who did not want to wait.
        // The game is in, and the ladder has nothing left to look for.
        var puuid = UniquePuuid();
        var earlier = UniqueMatchId();
        var fresh = UniqueMatchId();

        var riot = new FakeRiot()
            .WithMatchIds(puuid, earlier)
            .WithMatch(earlier, MatchPayloads.TenPlayerGame(earlier, T0 - 3_600_000, 420, [puuid]))
            .WithMatch(fresh, MatchPayloads.TenPlayerGame(fresh, T0, 420, [puuid]));

        await using var rig = Start(riot);
        var accountId = await AddAccountAsync(rig, puuid);
        await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual);

        // The first attempt, before Riot has the game.
        rig.Ladders.Schedule(accountId);
        await FirstAttemptAsync(rig, riot, accountId, puuid);

        riot.WithMatchIds(puuid, fresh, earlier);
        Assert.Equal(1, (await rig.Sync.SyncAsync(accountId, SyncTrigger.Manual)).Stored);

        var listed = IdListReads(riot, Game.Lol, puuid);
        await RunOutAsync(rig, accountId, Game.Lol);

        Assert.Equal(listed, IdListReads(riot, Game.Lol, puuid));
    }

    [Fact]
    public async Task A_tft_ladder_whose_lobby_another_member_stored_makes_no_further_attempts()
    {
        // TFT's ladder is the longer one — six attempts over most of an hour,
        // since Riot publishes a lobby only once all eight are out — so a lobby
        // two members shared cost more still for nothing.
        var mine = UniquePuuid();
        var theirs = UniquePuuid();
        var earlier = UniqueMatchId();
        var shared = UniqueMatchId();

        var riot = new FakeRiot()
            .WithTftMatchIds(mine, earlier)
            .WithTftMatchIds(theirs, earlier)
            .WithTftMatch(earlier, TftPayloads.Lobby(earlier, T0 - 3_600_000, 1100, [mine, theirs]))
            .WithTftMatch(shared, TftPayloads.Lobby(shared, T0, 1100, [theirs, mine]));

        await using var rig = Start(riot);
        var myId = await AddAccountAsync(rig, mine);
        var theirId = await AddAccountAsync(rig, theirs);

        await rig.Sync.SyncAsync(myId, Game.Tft, SyncTrigger.Manual);
        await rig.Sync.SyncAsync(theirId, Game.Tft, SyncTrigger.Manual);

        rig.Ladders.Schedule(theirId, Game.Tft);
        riot.WithTftMatchIds(mine, shared, earlier).WithTftMatchIds(theirs, shared, earlier);
        Assert.Equal(1, (await rig.Sync.SyncAsync(myId, Game.Tft, SyncTrigger.Auto)).Stored);

        var listed = IdListReads(riot, Game.Tft, theirs);
        await RunOutAsync(rig, theirId, Game.Tft);

        Assert.Equal(listed + 1, IdListReads(riot, Game.Tft, theirs));
        Assert.Equal(1, riot.MatchFetchCount(shared));
        Assert.Equal(shared, await rig.Sync.MostRecentMatchIdAsync(theirId, Game.Tft));
    }
}
