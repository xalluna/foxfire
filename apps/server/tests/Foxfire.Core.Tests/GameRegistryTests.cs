using System.Text.Json;
using Foxfire.Core;

namespace Foxfire.Core.Tests;

/// <summary>
/// The server's games and ladders, checked against the TypeScript registry.
///
/// fixtures/game-registry.json is written from packages/core/src/games by
/// <c>npm run generate-game-registry</c>, and the TypeScript suite asserts it
/// still describes that registry. This asserts <see cref="Games"/>,
/// <see cref="RankedQueues"/>, <see cref="RatedTiers"/> and
/// <see cref="TftPlacements"/> describe it too — so a ladder added to one side
/// and not the other fails a build here rather than a sync in production, and
/// the TFT rules both sides compute give the same answers because they were
/// both run on the same lobbies.
/// </summary>
public class GameRegistryTests
{
    // Declared before Loaded, and that order is load-bearing — see LadderCorpusTests.
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly JsonElement Loaded = Load();

    private static JsonElement Load()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);

        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "fixtures", "game-registry.json");
            if (File.Exists(candidate)) return JsonSerializer.Deserialize<JsonElement>(File.ReadAllText(candidate), Json);
            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            "fixtures/game-registry.json was not found above " + AppContext.BaseDirectory +
            ". Regenerate it with `npm run generate-game-registry` from packages/core.");
    }

    [Fact]
    public void Every_game_agrees_on_its_slug_folder_key_and_queues()
    {
        var games = Loaded.GetProperty("games").EnumerateArray().ToList();
        Assert.Equal(Games.All.Select(g => g.Slug()), games.Select(g => g.GetProperty("id").GetString()));

        foreach (var entry in games)
        {
            var game = Games.FromSlug(entry.GetProperty("id").GetString())!.Value;

            Assert.Equal(entry.GetProperty("folder").GetString(), game.Folder());
            Assert.Equal(entry.GetProperty("keyScope").GetString(), game.KeyScope().Slug());
            Assert.Equal(
                entry.GetProperty("queues").EnumerateArray()
                    .Select(q => (q.GetProperty("id").GetInt32(), q.GetProperty("folder").GetString()!)),
                game.Queues());
            Assert.Equal(
                entry.GetProperty("postGameRetryMs").EnumerateArray().Select(ms => ms.GetInt64()),
                game.PostGameRetryDelays().Select(d => (long)d.TotalMilliseconds));
        }
    }

    [Fact]
    public void Every_ladder_agrees_on_its_game_queue_and_scale()
    {
        var ladders = Loaded.GetProperty("ladders").EnumerateArray().ToList();
        Assert.Equal(RankedQueues.All.Select(q => q.RiotName()), ladders.Select(l => l.GetProperty("id").GetString()));

        foreach (var entry in ladders)
        {
            var queue = RankedQueues.FromRiotName(entry.GetProperty("id").GetString())!.Value;

            Assert.Equal(entry.GetProperty("game").GetString(), queue.Game().Slug());
            Assert.Equal(entry.GetProperty("queueId").GetInt32(), queue.QueueId());
            Assert.Equal(queue, RankedQueues.FromQueueId(queue.QueueId()));
            Assert.Equal(entry.GetProperty("scale").GetString(), queue.Scale() == LadderScale.Rated ? "rated" : "divisioned");
            Assert.Equal(entry.GetProperty("lpEditable").GetBoolean(), queue.LpEditable());
            Assert.Equal(entry.GetProperty("placementSlots").GetInt32(), queue.PlacementSlots());
        }
    }

    [Fact]
    public void The_rated_tiers_start_where_the_desktop_draws_them()
    {
        var floors = Loaded.GetProperty("ratedTierFloors").EnumerateArray()
            .Select(f => (f.GetProperty("tier").GetString(), f.GetProperty("floor").GetInt32()));

        Assert.Equal(floors, RatedTiers.All.Select(t => ((string?)t.RiotName(), t.Floor())));
    }

    [Fact]
    public void Team_placement_agrees_with_the_desktop()
    {
        foreach (var lobby in Loaded.GetProperty("teamPlacements").EnumerateArray())
        {
            var players = lobby.GetProperty("players").EnumerateArray()
                .Select(p => new PlacedPlayer(
                    p.GetProperty("puuid").GetString()!,
                    p.GetProperty("placement").GetInt32(),
                    p.GetProperty("partnerGroupId").ValueKind == JsonValueKind.Null
                        ? null
                        : p.GetProperty("partnerGroupId").GetInt32()))
                .ToList();

            var expected = lobby.GetProperty("teams").EnumerateObject()
                .ToDictionary(t => t.Name, t => t.Value.GetInt32());

            Assert.Equal(expected, TftPlacements.TeamPlacements(players));
        }
    }

    [Fact]
    public void Rated_movement_agrees_with_the_desktop()
    {
        foreach (var pair in Loaded.GetProperty("ratedMovements").EnumerateArray())
        {
            var movement = RatedTiers.Movement(
                RatedTiers.FromRiotName(pair.GetProperty("before").GetString()),
                RatedTiers.FromRiotName(pair.GetProperty("after").GetString()));

            Assert.Equal(pair.GetProperty("movement").GetString(), movement switch
            {
                RankMovement.Promotion => "promotion",
                RankMovement.Demotion => "demotion",
                _ => "none"
            });
        }
    }

    [Fact]
    public void A_tft_game_is_placed_where_the_desktop_places_it()
    {
        foreach (var game in Loaded.GetProperty("gameEnds").EnumerateArray())
        {
            var eliminated = game.GetProperty("timeEliminated");

            Assert.Equal(
                game.GetProperty("end").GetInt64(),
                TftPlacements.GameEnd(
                    game.GetProperty("gameCreation").GetInt64(),
                    eliminated.ValueKind == JsonValueKind.Null ? null : eliminated.GetDouble(),
                    game.GetProperty("gameDuration").GetInt32()));
        }
    }

    [Fact]
    public void Leagues_ladders_are_still_the_two_it_always_had()
    {
        Assert.Equal([RankedQueue.SoloDuo, RankedQueue.Flex], RankedQueues.Of(Game.Lol));
        Assert.Equal(RankedQueue.Flex, RankedQueues.FromRiotName("RANKED_FLEX_SR", Game.Lol));
        Assert.Null(RankedQueues.FromRiotName("RANKED_TFT", Game.Lol));
        Assert.Equal(RankedQueue.TftHyperRoll, RankedQueues.FromRiotName("RANKED_TFT_TURBO", Game.Tft));
    }
}
