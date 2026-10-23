using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Everything the TFT screens read, against rows written straight into the
/// database: a player's history a page at a time, a lobby, the placement spread
/// this set, rank on TFT's ladders, and LP typed for TFT.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class TftReadTests(FoxfireServerFixture server)
{
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private sealed record Seeded(HttpClient Client, Guid AccountId, string Puuid, string[] MatchIds) : IDisposable
    {
        public void Dispose() => Client.Dispose();
    }

    private static TftParticipant Board(string matchId, string puuid, int placement, int? team = null, int? group = null) => new()
    {
        MatchId = matchId,
        Puuid = puuid,
        GameName = $"T{placement}",
        TagLine = "NA1",
        Placement = placement,
        TeamPlacement = team,
        PartnerGroupId = group,
        Level = 8,
        LastRound = 30,
        TimeEliminated = 1500 + (8 - placement) * 60,
        PlayersEliminated = 1,
        TotalDamageToPlayers = 90,
        GoldLeft = 2,
        Win = placement <= 4,
        TraitsJson = """[{"name":"TFT18_FloraFatalis","numUnits":4,"style":3,"tierCurrent":2,"tierTotal":3}]""",
        UnitsJson = """[{"characterId":"TFT18_Jinx","tier":2,"rarity":4,"items":["TFT_Item_InfinityEdge"]}]""",
        AugmentsJson = """["TFT18_Augment_Pandora"]"""
    };

    /// <summary>
    /// An admin's own account with four TFT games — two Ranked, one Double Up,
    /// one Hyper Roll — and one League game, newest first in that order.
    /// </summary>
    private async Task<Seeded> SeedAsync()
    {
        var (client, session) = await server.AdminAsync();
        var now = DateTimeOffset.UtcNow;
        var puuid = $"puuid-{Guid.NewGuid():N}";
        string[] ids = [UniqueMatchId(), UniqueMatchId(), UniqueMatchId(), UniqueMatchId(), UniqueMatchId()];

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = puuid,
            GameName = $"Board{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = session.User.Id,
            LinkedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        (int Queue, int Placement, int? Team)[] games = [(1100, 1, null), (1100, 6, null), (1160, 3, 2), (1130, 2, null)];

        for (var i = 0; i < games.Length; i++)
        {
            var (queue, placement, team) = games[i];
            var match = new Match
            {
                MatchId = ids[i],
                Game = Game.Tft,
                GameCreation = T0 - (i * 3_600_000L),
                GameDuration = 2200,
                GameMode = "TFT",
                QueueId = queue,
                PlatformId = "NA1",
                TftSetNumber = 18,
                RawJson = "{}",
                FetchedAt = now
            };

            match.TftParticipants.Add(Board(ids[i], puuid, placement, team, team is null ? null : 1));
            match.TftParticipants.Add(Board(ids[i], $"stranger-{ids[i]}", placement == 1 ? 2 : 1, team is null ? null : 1, team is null ? null : 2));
            db.Matches.Add(match);
        }

        db.Matches.Add(new Match
        {
            MatchId = ids[4],
            GameCreation = T0 - 20_000_000,
            GameDuration = 1800,
            GameMode = "CLASSIC",
            QueueId = 420,
            PlatformId = "NA1",
            RawJson = "{}",
            FetchedAt = now
        });

        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = ids[4],
            Puuid = puuid,
            TeamId = 100,
            Win = true,
            ChampionId = 1,
            Items = { 0 }
        });

        db.MatchRanks.Add(new MatchRank
        {
            MatchId = ids[0],
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT",
            TierBefore = RankTier.Gold,
            DivisionBefore = RankDivision.II,
            LpBefore = 40,
            TierAfter = RankTier.Gold,
            DivisionAfter = RankDivision.II,
            LpAfter = 82,
            LpDelta = 42
        });

        db.RankSnapshots.Add(new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT",
            Tier = RankTier.Gold,
            Division = RankDivision.II,
            LeaguePoints = 40,
            LadderPosition = Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, 40)),
            Source = RankSources.Lcu,
            CapturedAt = T0 - 30_000_000
        });

        db.LeagueEntries.Add(new LeagueEntry
        {
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT_TURBO",
            RatedTier = RatedTier.Purple,
            RatedRating = 3612,
            FetchedAt = now
        });

        await db.SaveChangesAsync();
        return new Seeded(client, account.Id, puuid, ids);
    }

    [Fact]
    public async Task History_comes_a_page_at_a_time_newest_first_and_filters_by_queue()
    {
        using var seeded = await SeedAsync();
        var (client, id, _, ids) = (seeded.Client, seeded.AccountId, seeded.Puuid, seeded.MatchIds);

        var response = await client.GetAsync(new Uri($"/api/riot-accounts/{id}/tft/matches?limit=2", UriKind.Relative));
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var first = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(4, first.GetProperty("total").GetInt32());
        Assert.Equal([ids[0], ids[1]], first.GetProperty("items").EnumerateArray().Select(r => r.GetProperty("matchId").GetString()));

        var row = first.GetProperty("items")[0];
        Assert.Equal(1, row.GetProperty("placement").GetInt32());
        Assert.Equal(42, row.GetProperty("rank").GetProperty("lpDelta").GetInt32());
        Assert.Equal("TFT18_FloraFatalis", row.GetProperty("traits")[0].GetProperty("name").GetString());
        Assert.Equal("TFT_Item_InfinityEdge", row.GetProperty("units")[0].GetProperty("items")[0].GetString());

        var doubleUp = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{id}/tft/matches?queueId=1160", UriKind.Relative));
        Assert.Equal(1, doubleUp.GetProperty("total").GetInt32());
        Assert.Equal(2, doubleUp.GetProperty("items")[0].GetProperty("teamPlacement").GetInt32());

        // League's history has League's game and nothing of TFT's.
        var league = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/riot-accounts/{id}/matches", UriKind.Relative));
        Assert.All(league.GetProperty("items").EnumerateArray(), r => Assert.Equal(ids[4], r.GetProperty("matchId").GetString()));

        var one = await client.GetFromJsonAsync<JsonElement>(new Uri($"/api/riot-accounts/{id}/tft/matches/{ids[2]}", UriKind.Relative));
        Assert.Equal(ids[2], one.GetProperty("matchId").GetString());
    }

    [Fact]
    public async Task A_lobby_lists_every_board_best_first_and_names_the_players_tracked_here()
    {
        using var seeded = await SeedAsync();

        var lobby = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{seeded.AccountId}/tft/matches/{seeded.MatchIds[1]}/lobby", UriKind.Relative));

        var players = lobby.GetProperty("participants").EnumerateArray().ToList();
        Assert.Equal([1, 6], players.Select(p => p.GetProperty("placement").GetInt32()));
        Assert.Equal(seeded.AccountId, players[1].GetProperty("accountId").GetGuid());
        Assert.Equal(JsonValueKind.Null, players[0].GetProperty("accountId").ValueKind);

        var league = await seeded.Client.GetAsync(
            new Uri($"/api/riot-accounts/{seeded.AccountId}/tft/matches/{seeded.MatchIds[4]}/lobby", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, league.StatusCode);
    }

    [Fact]
    public async Task The_dashboard_counts_this_sets_placements_by_ladder_and_by_team_in_double_up()
    {
        using var seeded = await SeedAsync();

        var dashboard = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{seeded.AccountId}/tft/dashboard", UriKind.Relative));

        var ladders = dashboard.GetProperty("ladders").EnumerateArray().ToDictionary(l => l.GetProperty("queueType").GetString()!);

        var ranked = ladders["RANKED_TFT"];
        Assert.Equal(2, ranked.GetProperty("games").GetInt32());
        Assert.Equal([1, 0, 0, 0, 0, 1, 0, 0], ranked.GetProperty("placements").EnumerateArray().Select(p => p.GetInt32()));
        Assert.Equal(3.5, ranked.GetProperty("averagePlacement").GetDouble());
        Assert.Equal(0.5, ranked.GetProperty("topRate").GetDouble());

        var doubleUp = ladders["RANKED_TFT_DOUBLE_UP"];
        Assert.Equal([0, 1, 0, 0], doubleUp.GetProperty("placements").EnumerateArray().Select(p => p.GetInt32()));
        Assert.Equal(1.0, doubleUp.GetProperty("topRate").GetDouble());

        var entry = Assert.Single(dashboard.GetProperty("leagueEntries").EnumerateArray());
        Assert.Equal("PURPLE", entry.GetProperty("ratedTier").GetString());
        Assert.Equal("Set 18", dashboard.GetProperty("seasonLabel").GetString());
        Assert.False(string.IsNullOrEmpty(dashboard.GetProperty("tftAccess").GetString()));
    }

    [Fact]
    public async Task Tft_rank_reads_tft_ladders_and_league_routes_still_refuse_them()
    {
        using var seeded = await SeedAsync();
        var id = seeded.AccountId;

        var history = await seeded.Client.GetAsync(new Uri($"/api/riot-accounts/{id}/tft/rank/history?queueType=RANKED_TFT&range=all", UriKind.Relative));
        history.EnsureSuccessStatusCode();
        var body = await history.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Single(body.GetProperty("snapshots").EnumerateArray());

        var leagueOnTft = await seeded.Client.GetAsync(new Uri($"/api/riot-accounts/{id}/tft/rank/history?queueType=RANKED_SOLO_5x5", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, leagueOnTft.StatusCode);

        var tftOnLeague = await seeded.Client.GetAsync(new Uri($"/api/riot-accounts/{id}/rank/history?queueType=RANKED_TFT", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, tftOnLeague.StatusCode);

        var periods = await seeded.Client.GetFromJsonAsync<JsonElement>(new Uri($"/api/riot-accounts/{id}/tft/rank/periods", UriKind.Relative));
        Assert.All(periods.EnumerateArray(), p => Assert.Equal("tft", p.GetProperty("game").GetString()));
    }

    [Fact]
    public async Task Tft_lp_can_be_typed_and_cleared_but_hyper_roll_has_none_to_type()
    {
        using var seeded = await SeedAsync();
        var id = seeded.AccountId;

        var editable = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{id}/tft/rank/editable?queueType=RANKED_TFT", UriKind.Relative));

        var game = editable.EnumerateArray().Single(g => g.GetProperty("matchId").GetString() == seeded.MatchIds[1]);
        Assert.Equal(6, game.GetProperty("placement").GetInt32());
        Assert.Equal("GOLD", game.GetProperty("before").GetProperty("tier").GetString());

        var hyperRoll = await seeded.Client.GetAsync(
            new Uri($"/api/riot-accounts/{id}/tft/rank/editable?queueType=RANKED_TFT_TURBO", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, hyperRoll.StatusCode);

        var saved = await seeded.Client.PostAsJsonAsync(
            new Uri($"/api/riot-accounts/{id}/tft/rank/manual", UriKind.Relative),
            new
            {
                queueType = "RANKED_TFT",
                edits = new[] { new { matchId = seeded.MatchIds[1], after = new { tier = "GOLD", rank = "II", leaguePoints = 25 } } }
            });
        Assert.True(saved.IsSuccessStatusCode, await saved.Content.ReadAsStringAsync());

        var row = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{id}/tft/matches/{seeded.MatchIds[1]}", UriKind.Relative));
        Assert.True(row.GetProperty("hasManualRank").GetBoolean());
        Assert.Equal(-15, row.GetProperty("rank").GetProperty("lpDelta").GetInt32());

        var cleared = await seeded.Client.DeleteAsync(
            new Uri($"/api/riot-accounts/{id}/tft/rank/manual/{seeded.MatchIds[1]}", UriKind.Relative));
        Assert.True(cleared.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Tft_shapes_cross_the_wire_as_the_screens_read_them()
    {
        using var seeded = await SeedAsync();
        var id = seeded.AccountId;

        var dashboard = await seeded.Client.GetFromJsonAsync<JsonElement>(new Uri($"/api/riot-accounts/{id}/tft/dashboard", UriKind.Relative));
        AssertHasAll(dashboard, "account", "leagueEntries", "syncState", "ladders", "seasonLabel", "tftAccess");
        AssertHasAll(dashboard.GetProperty("ladders")[0], "queueType", "games", "placements", "averagePlacement", "topRate");

        var page = await seeded.Client.GetFromJsonAsync<JsonElement>(new Uri($"/api/riot-accounts/{id}/tft/matches", UriKind.Relative));
        AssertHasAll(
            page.GetProperty("items")[0],
            "matchId", "gameCreation", "gameDuration", "queueId", "setNumber", "placement", "teamPlacement", "level",
            "lastRound", "timeEliminated", "playersEliminated", "totalDamageToPlayers", "goldLeft", "traits", "units",
            "augments", "rank", "hasManualRank", "recording");
        AssertHasAll(page.GetProperty("items")[0].GetProperty("traits")[0], "name", "numUnits", "style", "tierCurrent", "tierTotal");
        AssertHasAll(page.GetProperty("items")[0].GetProperty("units")[0], "characterId", "tier", "rarity", "items");

        var lobby = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{id}/tft/matches/{seeded.MatchIds[0]}/lobby", UriKind.Relative));
        AssertHasAll(lobby, "matchId", "gameCreation", "gameDuration", "queueId", "setNumber", "participants");
        AssertHasAll(lobby.GetProperty("participants")[0], "puuid", "gameName", "tagLine", "accountId", "partnerGroupId", "placement");

        var editable = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{id}/tft/rank/editable?queueType=RANKED_TFT", UriKind.Relative));
        AssertHasAll(
            editable[0], "matchId", "gameCreation", "gameDuration", "queueId", "placement", "teamPlacement", "before",
            "beforeAt", "beforeUsable", "manual");
    }

    [Fact]
    public async Task An_imported_tft_game_is_filed_under_the_id_this_server_uses()
    {
        using var seeded = await SeedAsync();
        var desktopPuuid = $"desktop-{Guid.NewGuid():N}";
        var matchId = UniqueMatchId();

        await using (var scope = server.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            db.RetiredPuuids.Add(new RetiredPuuid { RiotAccountId = seeded.AccountId, Puuid = desktopPuuid, RetiredAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
        }

        var imported = await seeded.Client.PostAsJsonAsync(
            new Uri("/api/admin/import/tft-matches", UriKind.Relative),
            new[] { new { matchId, rawJson = TftPayloads.Lobby(matchId, T0 - 50_000_000, 1100, [desktopPuuid]) } });

        imported.EnsureSuccessStatusCode();
        Assert.Equal(1, (await imported.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("accepted").GetInt32());

        await using var check = server.Services.CreateAsyncScope();
        var stored = check.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        Assert.True(await stored.TftParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == seeded.Puuid));
        Assert.False(await stored.TftParticipants.AnyAsync(p => p.MatchId == matchId && p.Puuid == desktopPuuid));
    }

#if FEATURE_YOUTUBE
    [Fact]
    public async Task A_recording_attaches_to_a_tft_game_and_rides_on_its_row()
    {
        using var seeded = await SeedAsync();

        var attached = await seeded.Client.PutAsJsonAsync(
            new Uri($"/api/riot-accounts/{seeded.AccountId}/matches/{seeded.MatchIds[0]}/recording", UriKind.Relative),
            new { youtubeVideoId = "dQw4w9WgXcQ", source = "upload", privacy = "unlisted" });

        Assert.True(attached.IsSuccessStatusCode, await attached.Content.ReadAsStringAsync());

        var row = await seeded.Client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{seeded.AccountId}/tft/matches/{seeded.MatchIds[0]}", UriKind.Relative));
        Assert.Equal("dQw4w9WgXcQ", row.GetProperty("recording").GetProperty("youtubeVideoId").GetString());
    }
#endif

    private static void AssertHasAll(JsonElement element, params string[] expected)
    {
        var actual = element.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        var missing = expected.Where(name => !actual.Contains(name)).ToList();
        Assert.True(missing.Count == 0, $"Missing on the wire: {string.Join(", ", missing)}. Present: {string.Join(", ", actual)}");
    }
}
