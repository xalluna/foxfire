using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The names on the wire, asserted as names.
///
/// Every payload here is consumed by a TypeScript type in apps/desktop that no
/// compiler can check against this one. A field spelled differently on the two
/// sides does not fail: it arrives as undefined, and a screen renders a blank
/// where a number should be. That is the worst shape of bug available to this
/// project — silent, cosmetic-looking, and invisible to both test suites.
///
/// So these tests read the raw JSON rather than deserialising it, and name the
/// keys out loud. The list is short because only the shapes the desktop reads
/// are on it, and each one is paired in a comment with the type it feeds.
///
/// Two of these were wrong when the suite was written. The sync state called the
/// account `riotAccountId`, and a hand-entered rank called the division
/// `division` — which is what Foxfire.Core calls it and what the desktop does
/// not. Both would have read as undefined.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class WireShapeTests(FoxfireServerFixture server)
{
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    /// <summary>Every property name on an object, so a test can name what it expects.</summary>
    private static IReadOnlyList<string> KeysOf(JsonElement element) =>
        [.. element.EnumerateObject().Select(p => p.Name)];

    /// <summary>
    /// A tier and a division, spelled the way the desktop reads them.
    ///
    /// The only assertion here about values rather than names, and it earns the
    /// exception. Both are enums on this side now, and System.Text.Json
    /// serialises an enum as a number unless somebody says otherwise — so a
    /// forgotten conversion at one of these boundaries sends 3 where GOLD
    /// belongs. The desktop's type says `tier: string | null`, so it would not
    /// fail: it would look up a crest for 3, find none, and draw nothing.
    /// </summary>
    private static void AssertRiotSpelling(JsonElement element)
    {
        Assert.Equal(JsonValueKind.String, element.GetProperty("tier").ValueKind);
        Assert.Equal("GOLD", element.GetProperty("tier").GetString());
        Assert.Equal("II", element.GetProperty("rank").GetString());
    }

    private static void AssertHasAll(JsonElement element, params string[] expected)
    {
        var actual = KeysOf(element).ToHashSet(StringComparer.Ordinal);
        var missing = expected.Where(name => !actual.Contains(name)).ToList();

        Assert.True(
            missing.Count == 0,
            $"Missing on the wire: {string.Join(", ", missing)}. Present: {string.Join(", ", actual)}");
    }

    private async Task<(HttpClient Client, Guid AccountId, string MatchId)> RiggedAsync()
    {
        var (client, session) = await server.AdminAsync();

        var now = DateTimeOffset.UtcNow;
        var matchId = $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

        await using var scope = server.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Wire{Guid.NewGuid().ToString("N")[..8]}",
            TagLine = "NA1",
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = session.User.Id,
            LinkedAt = now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);

        db.Matches.Add(new Match
        {
            MatchId = matchId,
            GameCreation = T0,
            GameDuration = 1800,
            GameMode = "CLASSIC",
            GameType = "MATCHED_GAME",
            QueueId = 420,
            PlatformId = "NA1",
            RawJson = "{}",
            FetchedAt = now
        });

        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = account.Puuid,
            GameName = account.GameName,
            TagLine = "NA1",
            TeamId = 100,
            Win = true,
            ChampionId = 64,
            ChampionName = "Lee Sin",
            ChampLevel = 16,
            Kills = 8,
            Deaths = 4,
            Assists = 6,
            GoldEarned = 13_000,
            Cs = 190,
            DamageDealtToChampions = 20_000,
            DamageTaken = 24_000,
            Items = { 3153, 3006, 6672, 3031, 3072, 0, 3363 },
            PerksJson = """{"statPerks":{"defense":5002}}""",
            TeamPosition = "JUNGLE",
            LargestMultiKill = 2,
            RoleBoundItem = 0
        });

        db.LeagueEntries.Add(new LeagueEntry
        {
            RiotAccountId = account.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            Tier = RankTier.Gold,
            Division = RankDivision.II,
            LeaguePoints = 62,
            Wins = 31,
            Losses = 28,
            FetchedAt = now
        });

        db.RankSnapshots.Add(new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            Tier = RankTier.Gold,
            Division = RankDivision.II,
            LeaguePoints = 62,
            LadderPosition = Ladder.LadderPosition(new Rank(RankTier.Gold, RankDivision.II, 62)),
            Source = RankSources.LeagueV4,

            // Before the game, not after. The editor offers the rank going
            // in, so a reading that postdates the only game in the rig leaves
            // nothing to inspect.
            CapturedAt = T0 - 60_000
        });

        db.SyncStates.Add(new SyncState
        {
            RiotAccountId = account.Id,
            MostRecentMatchId = matchId,
            BackfillComplete = true,
            BackfillTarget = 200,
            LastFullSyncAt = now,
            LastDeltaSyncAt = now
        });

        await db.SaveChangesAsync();

        return (client, account.Id, matchId);
    }

    [Fact]
    public async Task An_account_carries_every_field_the_desktops_Account_reads()
    {
        // @shared/types Account, plus the two a shared server adds.
        var (client, _, _) = await RiggedAsync();
        using var _client = client;

        var accounts = await client.GetFromJsonAsync<JsonElement>(
            new Uri("/riot-accounts", UriKind.Relative));

        var account = accounts.EnumerateArray().First();

        AssertHasAll(
            account,
            "id",
            "puuid",
            "gameName",
            "tagLine",
            "platform",
            "regionalRoute",
            "summonerId",
            "profileIconId",
            "summonerLevel",
            "isHomeAccount",
            "createdAt",
            "updatedAt",
            "isMine",
            "ownerUsername");
    }

    [Fact]
    public async Task A_sync_state_calls_the_account_what_the_desktop_calls_it()
    {
        // @shared/types SyncState. This one was wrong: riotAccountId, which the
        // desktop reads as undefined and then keys a progress bar on.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var state = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/sync/{accountId}", UriKind.Relative));

        AssertHasAll(
            state,
            "accountId",
            "mostRecentMatchId",
            "backfillComplete",
            "backfillTarget",
            "lastFullSyncAt",
            "lastDeltaSyncAt");
    }

    [Fact]
    public async Task A_match_row_carries_every_field_the_row_component_draws()
    {
        // @shared/types MatchSummary, minus recordingId and replayId — those are
        // files on one machine and the desktop fills them in from its own SQLite.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var rows = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/riot-accounts/{accountId}/matches", UriKind.Relative));

        var row = rows.EnumerateArray().First();

        AssertHasAll(
            row,
            "matchId",
            "gameCreation",
            "gameDuration",
            "gameMode",
            "queueId",
            "win",
            "championId",
            "championName",
            "champLevel",
            "kills",
            "deaths",
            "assists",
            "cs",
            "goldEarned",
            "damageDealtToChampions",
            "largestMultiKill",
            "items",
            "roleBoundItem",
            "summoner1Id",
            "summoner2Id",
            "perks",
            "teamPosition",
            "teamKills",
            "teamDamage",
            "isRemake",
            "rank",
            "hasManualRank");
    }

    [Fact]
    public async Task A_dashboard_carries_the_three_things_the_account_page_opens_with()
    {
        // @shared/api DashboardData, and @shared/types LeagueEntry inside it.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var dashboard = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/riot-accounts/{accountId}/dashboard", UriKind.Relative));

        AssertHasAll(dashboard, "account", "leagueEntries", "syncState");

        var entry = dashboard.GetProperty("leagueEntries").EnumerateArray().First();

        // "rank" and not "division": Riot's own name for it, and the desktop's.
        AssertHasAll(entry, "queueType", "tier", "rank", "leaguePoints", "wins", "losses", "fetchedAt");

        AssertRiotSpelling(entry);
    }

    [Fact]
    public async Task A_rank_reading_crosses_the_wire_as_the_graph_plots_it()
    {
        // @shared/types RankHistory, RankSnapshot.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var history = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/riot-accounts/{accountId}/rank/history?queueType=RANKED_SOLO_5x5&range=all",
                UriKind.Relative));

        AssertHasAll(history, "snapshots", "milestones");

        var snapshot = history.GetProperty("snapshots").EnumerateArray().First();

        AssertHasAll(
            snapshot,
            "queueType",
            "tier",
            "rank",
            "leaguePoints",
            "wins",
            "losses",
            "ladderPosition",
            "source",
            "capturedAt",
            "seasonId");

        AssertRiotSpelling(snapshot);
    }

    [Fact]
    public async Task An_editable_game_offers_a_rank_the_editor_can_fill_in()
    {
        // @shared/types EditableMatch, ManualRank. The rank was wrong here too:
        // Foxfire.Core calls the division a division, and the form does not.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var games = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/riot-accounts/{accountId}/rank/editable?queueType=RANKED_SOLO_5x5",
                UriKind.Relative));

        var game = games.EnumerateArray().First();

        AssertHasAll(
            game,
            "matchId",
            "gameCreation",
            "gameDuration",
            "win",
            "championId",
            "championName",
            "kills",
            "deaths",
            "assists",
            "before",
            "beforeAt",
            "beforeUsable",
            "manual");

        // The reading recorded in the rig sits before this game, so there is a
        // "before" to inspect — which is the object whose keys matter.
        AssertHasAll(game.GetProperty("before"), "tier", "rank", "leaguePoints");
    }

    [Fact]
    public async Task A_season_crosses_the_wire_as_the_picker_reads_one()
    {
        // @shared/types Season.
        var (client, _, _) = await RiggedAsync();
        using var _client = client;

        var seasons = await client.GetFromJsonAsync<JsonElement>(new Uri("/seasons", UriKind.Relative));
        var season = seasons.EnumerateArray().First();

        AssertHasAll(season, "id", "label", "startsAt", "isPreseason", "resetsRank");
    }

    [Fact]
    public async Task Champion_numbers_cross_the_wire_as_the_table_reads_them()
    {
        // @shared/types ChampionStats.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var stats = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/riot-accounts/{accountId}/champions", UriKind.Relative));

        var champion = stats.EnumerateArray().First();

        AssertHasAll(
            champion,
            "championId",
            "games",
            "wins",
            "kills",
            "deaths",
            "assists",
            "cs",
            "damageToChampions",
            "durationSeconds",
            "damageShare",
            "killParticipation");
    }

    [Fact]
    public async Task A_rank_reading_from_the_client_says_whether_it_was_filed()
    {
        // The watcher acts on the answer: a forced reading that was written is
        // what clears its wait for a post-game value to settle.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var response = await client.PostAsJsonAsync(
            new Uri("/rank-readings", UriKind.Relative),
            new
            {
                riotAccountId = accountId,
                queueType = "RANKED_SOLO_5x5",
                tier = "GOLD",
                division = "II",
                leaguePoints = 74,
                wins = 32,
                losses = 28,
                force = false
            });

        response.EnsureSuccessStatusCode();

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        AssertHasAll(body, "recorded");
        Assert.True(body.GetProperty("recorded").GetBoolean());

        // The same reading again has not moved, so nothing is filed — and the
        // desktop needs to be able to tell that from a write.
        var again = await client.PostAsJsonAsync(
            new Uri("/rank-readings", UriKind.Relative),
            new
            {
                riotAccountId = accountId,
                queueType = "RANKED_SOLO_5x5",
                tier = "GOLD",
                division = "II",
                leaguePoints = 74,
                wins = 32,
                losses = 28,
                force = false
            });

        var repeat = await again.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(repeat.GetProperty("recorded").GetBoolean());
    }
}
