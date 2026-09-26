using System.Buffers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.SignalR.Protocol;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The names on the wire, asserted as names.
///
/// Every payload here is consumed by a TypeScript type in packages/core — read
/// by the desktop and the web client alike — that no compiler can check against
/// this one. A field spelled differently on the two
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
        // @foxfire/core Account, plus the two a shared server adds.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var account = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}", UriKind.Relative));

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
    public async Task Every_list_that_grows_answers_with_a_page()
    {
        // @foxfire/core Page<T>. Nothing on the TypeScript side can tell an
        // array from a page at compile time; a route that still answered with
        // an array would read as { items: undefined } and draw an empty list.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        string[] paged =
        [
            "/api/search?q=",
            $"/api/riot-accounts/{accountId}/matches",
            "/api/admin/users/",
            "/api/admin/invites/used",
            "/api/admin/storage/replays",
            "/api/admin/insights/logs"
        ];

        foreach (var route in paged)
        {
            var page = await client.GetFromJsonAsync<JsonElement>(new Uri(route, UriKind.Relative));

            Assert.True(page.ValueKind == JsonValueKind.Object, $"{route} answered with {page.ValueKind}");
            AssertHasAll(page, "items", "total");
            Assert.Equal(JsonValueKind.Array, page.GetProperty("items").ValueKind);
            Assert.Equal(JsonValueKind.Number, page.GetProperty("total").ValueKind);
        }

        // The open invites cannot grow — they expire — so they stay a list.
        var open = await client.GetFromJsonAsync<JsonElement>(new Uri("/api/admin/invites/", UriKind.Relative));
        Assert.Equal(JsonValueKind.Array, open.ValueKind);
    }

    [Fact]
    public async Task A_sync_state_calls_the_account_what_the_desktop_calls_it()
    {
        // @foxfire/core SyncState. This one was wrong: riotAccountId, which the
        // desktop reads as undefined and then keys a progress bar on.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var state = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/sync/{accountId}", UriKind.Relative));

        AssertHasAll(
            state,
            "accountId",
            "mostRecentMatchId",
            "backfillComplete",
            "backfillTarget",
            "lastFullSyncAt",
            "lastDeltaSyncAt",
            "cooldownUntil");
    }

    /// <summary>
    /// A progress event, written by the hub protocol this server actually runs.
    ///
    /// The second assertion about values rather than names, for the reason the
    /// first one gives. @foxfire/core SyncProgressEvent types phase and trigger
    /// as lowercase literals, and the screens decide a sync is over by comparing
    /// against 'complete'. The server wrote "Complete" from the day it had a hub,
    /// so no sync on a server ever finished as far as a progress bar could tell.
    /// </summary>
    [Theory]
    [InlineData(SyncPhase.Backfill, "backfill")]
    [InlineData(SyncPhase.Delta, "delta")]
    [InlineData(SyncPhase.Complete, "complete")]
    [InlineData(SyncPhase.Error, "error")]
    public void A_sync_progress_event_spells_its_phase_the_way_the_screens_compare_it(
        SyncPhase phase, string expected)
    {
        var protocol = server.Services.GetServices<IHubProtocol>().Single(p => p.Name == "json");
        var output = new ArrayBufferWriter<byte>();

        protocol.WriteMessage(
            new InvocationMessage(
                HubEvents.SyncProgress,
                [new SyncProgressEvent(Guid.NewGuid(), phase, 1, 2, null, SyncTrigger.Auto)]),
            output);

        // The protocol ends every frame with a record separator.
        var frame = Encoding.UTF8.GetString(output.WrittenSpan).TrimEnd('\u001e');
        var progress = JsonDocument.Parse(frame).RootElement.GetProperty("arguments")[0];

        AssertHasAll(progress, "accountId", "phase", "current", "total", "message", "trigger", "cooldownUntil");
        Assert.Equal(expected, progress.GetProperty("phase").GetString());
        Assert.Equal("auto", progress.GetProperty("trigger").GetString());
    }

    [Fact]
    public async Task A_match_row_carries_every_field_the_row_component_draws()
    {
        // @foxfire/core MatchSummary, minus `local` — the recording and replay on
        // one machine's disk, which the desktop fills in from its own SQLite.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var page = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/matches", UriKind.Relative));

        var row = page.GetProperty("items").EnumerateArray().First();

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
            "hasManualRank",
            "sharedReplay",
            "recording");
    }

#if FEATURE_YOUTUBE
    [Fact]
    public async Task A_recording_carries_every_field_the_player_page_reads()
    {
        // @foxfire/core MatchRecording, and its RecordingEvent — the desktop's
        // own shape, so the web draws the markers the desktop always did.
        var (client, accountId, matchId) = await RiggedAsync();
        using var _client = client;

        var uri = new Uri($"/api/riot-accounts/{accountId}/matches/{matchId}/recording", UriKind.Relative);

        (await client.PutAsJsonAsync(uri, new
        {
            youtubeVideoId = "dQw4w9WgXcQ",
            source = "upload",
            privacy = "unlisted",
            title = "Lee Sin · Ranked Solo/Duo · Victory · 8/4/6",
            durationSeconds = 1790,
            events = new[]
            {
                new { eventId = 3, name = "ChampionKill", gameTime = 342.5, videoTime = 252.5, role = "kill", label = "Ahri" }
            }
        })).EnsureSuccessStatusCode();

        var recording = await client.GetFromJsonAsync<JsonElement>(uri);

        AssertHasAll(
            recording,
            "youtubeVideoId",
            "privacy",
            "hasEvents",
            "title",
            "durationSeconds",
            "source",
            "attachedBy",
            "attachedAt",
            "events");

        AssertHasAll(
            recording.GetProperty("events")[0],
            "eventId",
            "name",
            "gameTime",
            "videoTime",
            "role",
            "label");

        var page = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/matches", UriKind.Relative));

        AssertHasAll(page.GetProperty("items")[0].GetProperty("recording"), "youtubeVideoId", "privacy", "hasEvents");
    }
#endif

    [Fact]
    public async Task A_dashboard_carries_the_three_things_the_account_page_opens_with()
    {
        // @foxfire/core DashboardData, and LeagueEntry inside it.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var dashboard = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/dashboard", UriKind.Relative));

        AssertHasAll(dashboard, "account", "leagueEntries", "syncState");

        var entry = dashboard.GetProperty("leagueEntries").EnumerateArray().First();

        // "rank" and not "division": Riot's own name for it, and the desktop's.
        AssertHasAll(entry, "queueType", "tier", "rank", "leaguePoints", "wins", "losses", "fetchedAt");

        AssertRiotSpelling(entry);
    }

    [Fact]
    public async Task A_rank_reading_crosses_the_wire_as_the_graph_plots_it()
    {
        // @foxfire/core RankHistory, RankSnapshot.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var history = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/rank/history?queueType=RANKED_SOLO_5x5&range=all",
                UriKind.Relative));

        // "before" is there even when it is null, so a client can tell a range
        // with nothing ahead of it from a server too old to say.
        AssertHasAll(history, "snapshots", "milestones", "before");

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
    public async Task A_rank_trend_crosses_the_wire_as_the_card_draws_it()
    {
        // @foxfire/core RankTrend, RankTrendPoint. The rig's one reading is two
        // hours old, so it closes today and nothing before it: one point.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var trend = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/rank/trend?queueType=RANKED_SOLO_5x5", UriKind.Relative));

        AssertHasAll(trend, "from", "to", "points", "netLp");

        var point = Assert.Single(trend.GetProperty("points").EnumerateArray().ToList());

        AssertHasAll(point, "at", "tier", "rank", "leaguePoints", "ladderPosition", "seasonId", "capturedAt");

        AssertRiotSpelling(point);
    }

    [Fact]
    public async Task An_editable_game_offers_a_rank_the_editor_can_fill_in()
    {
        // @foxfire/core EditableMatch, ManualRank. The rank was wrong here too:
        // Foxfire.Core calls the division a division, and the form does not.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var games = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/rank/editable?queueType=RANKED_SOLO_5x5",
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
        // @foxfire/core Season.
        var (client, _, _) = await RiggedAsync();
        using var _client = client;

        var seasons = await client.GetFromJsonAsync<JsonElement>(new Uri("/api/seasons", UriKind.Relative));
        var season = seasons.EnumerateArray().First();

        AssertHasAll(season, "id", "label", "startsAt", "isPreseason", "resetsRank");
    }

    [Fact]
    public async Task Champion_numbers_cross_the_wire_as_the_table_reads_them()
    {
        // @foxfire/core ChampionStats.
        var (client, accountId, _) = await RiggedAsync();
        using var _client = client;

        var stats = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{accountId}/champions", UriKind.Relative));

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
            new Uri("/api/rank-readings", UriKind.Relative),
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
            new Uri("/api/rank-readings", UriKind.Relative),
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
