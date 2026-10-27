using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Foxfire.Api.Reads;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The schema with two games in it, against a real SQL Server.
///
/// Every row from before TFT has to go on reading as League's, TFT has to fit
/// the keys League already uses — LP, hand-entered LP, recordings all point at a
/// match by id — and nothing League reads may pick a TFT row up by accident.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class MultiGameSchemaTests(FoxfireServerFixture server)
{
    private const long T0 = 1_790_000_000_000;

    private AsyncServiceScope Scope() => server.Services.CreateAsyncScope();

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private static async Task<RiotAccount> AddAccountAsync(FoxfireDbContext db)
    {
        var now = DateTimeOffset.UtcNow;
        var suffix = Guid.NewGuid().ToString("N")[..8];

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Tactician{suffix}",
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

    private static Match TftMatch(string matchId, long gameCreation, int queueId = 1100) => new()
    {
        MatchId = matchId,
        Game = Game.Tft,
        GameCreation = gameCreation,
        GameDuration = 2216,
        GameMode = "TFT",
        GameType = "standard",
        QueueId = queueId,
        PlatformId = "NA1",
        TftSetNumber = 18,
        TftSetCoreName = "TFTSet18",
        RawJson = """{"metadata":{},"info":{}}""",
        FetchedAt = DateTimeOffset.UtcNow
    };

    private static TftParticipant Board(string matchId, string puuid, int placement) => new()
    {
        MatchId = matchId,
        Puuid = puuid,
        Placement = placement,
        Level = 8,
        LastRound = 32,
        TimeEliminated = 1712.38,
        PlayersEliminated = 1,
        TotalDamageToPlayers = 96,
        GoldLeft = 3,
        Win = placement <= 4,
        TraitsJson = "[]",
        UnitsJson = "[]"
    };

    [Fact]
    public async Task A_row_written_without_a_game_reads_as_league()
    {
        // What every row from before the migration is. Written by SQL rather
        // than EF, which always names the game, so the column's own default is
        // what is under test.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var matchId = UniqueMatchId();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            INSERT INTO Matches (MatchId, GameCreation, GameDuration, QueueId, RawJson, FetchedAt)
            VALUES ({matchId}, {T0}, 1669, 420, '{"{}"}', SYSDATETIMEOFFSET())
            """);

        var match = await db.Matches.AsNoTracking().SingleAsync(m => m.MatchId == matchId);
        Assert.Equal(Game.Lol, match.Game);
    }

    [Fact]
    public async Task Tft_sets_are_seeded_beside_leagues_seasons_and_may_share_a_day()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var tft = await db.Seasons.AsNoTracking().Where(s => s.Game == Game.Tft).OrderBy(s => s.StartsAt).ToListAsync();
        Assert.Contains(tft, s => s.Label == "Set 18" && s.StartsAt == 1787702400000L && s.ResetsRank);
        Assert.DoesNotContain(
            await db.Seasons.AsNoTracking().Where(s => s.Game == Game.Lol).ToListAsync(),
            s => s.Label.StartsWith("Set ", StringComparison.Ordinal));

        // A League season opening the same instant as a TFT set is two games'
        // calendars agreeing, not two boundaries at one moment.
        var startsAt = 1_810_000_000_000L + Random.Shared.Next(1, 1_000_000);
        db.Seasons.Add(new RankedSeason { Label = "League", StartsAt = startsAt, ResetsRank = true, Game = Game.Lol });
        db.Seasons.Add(new RankedSeason { Label = "TFT", StartsAt = startsAt, ResetsRank = true, Game = Game.Tft });
        await db.SaveChangesAsync();

        await db.Seasons.Where(s => s.StartsAt == startsAt).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task A_tft_game_takes_its_boards_lp_and_a_hand_entered_rank_with_it()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        var matchId = UniqueMatchId();

        var match = TftMatch(matchId, T0);
        match.TftParticipants.Add(Board(matchId, account.Puuid, 1));
        match.TftParticipants.Add(Board(matchId, $"stranger-{Guid.NewGuid():N}", 8));
        db.Matches.Add(match);

        db.MatchRanks.Add(new MatchRank
        {
            MatchId = matchId,
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT_TURBO",
            LpBefore = 3360,
            LpAfter = 3412,
            LpDelta = 52,
            IsPromotion = true,
            RatedTierBefore = RatedTier.Blue,
            RatedTierAfter = RatedTier.Purple
        });

        db.RankSnapshots.Add(new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT",
            Tier = RankTier.Gold,
            Division = RankDivision.II,
            LeaguePoints = 40,
            LadderPosition = 1240,
            Source = "manual",
            CapturedAt = T0 + 1_712_380,
            MatchId = matchId
        });

        await db.SaveChangesAsync();

        var rank = await db.MatchRanks.AsNoTracking().SingleAsync(r => r.MatchId == matchId);
        Assert.Equal(RatedTier.Purple, rank.RatedTierAfter);
        Assert.Equal(2, await db.TftParticipants.CountAsync(p => p.MatchId == matchId));

        // The hand-entered reading's link is cleared by EF rather than by the
        // database, as League's is — SQL Server allows the account its cascade
        // into that table and no second one — so a delete outside EF clears it
        // first, as the account deletion path does.
        await db.RankSnapshots.Where(r => r.MatchId == matchId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.MatchId, (string?)null));
        await db.Matches.Where(m => m.MatchId == matchId).ExecuteDeleteAsync();

        Assert.Equal(0, await db.TftParticipants.CountAsync(p => p.MatchId == matchId));
        Assert.Equal(0, await db.MatchRanks.CountAsync(r => r.MatchId == matchId));
    }

    [Fact]
    public async Task An_account_syncs_each_game_on_its_own_row()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        db.SyncStates.Add(new SyncState { RiotAccountId = account.Id, Game = Game.Lol, BackfillTarget = 200 });
        db.SyncStates.Add(new SyncState { RiotAccountId = account.Id, Game = Game.Tft, BackfillTarget = 50 });
        await db.SaveChangesAsync();

        var states = await db.SyncStates.AsNoTracking().Where(s => s.RiotAccountId == account.Id).ToListAsync();
        Assert.Equal([Game.Lol, Game.Tft], states.Select(s => s.Game).Order());
    }

    [Fact]
    public async Task A_rated_reading_keeps_its_colour_and_its_rating()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        db.RankSnapshots.Add(new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT_TURBO",
            RatedTier = RatedTier.Orange,
            RatedRating = 4310,
            LadderPosition = 4310,
            Source = "lcu",
            CapturedAt = T0
        });
        await db.SaveChangesAsync();

        var reading = (await db.RankSnapshots.AsNoTracking().SingleAsync(r => r.RiotAccountId == account.Id)).ToReading();
        Assert.Equal(RankedQueue.TftHyperRoll, reading.Queue);
        Assert.Equal(RatedTier.Orange, reading.RatedTier);
        Assert.Equal(4310, reading.LadderPosition);
    }

    [Fact]
    public async Task League_reads_see_nothing_of_tft()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        var matchId = UniqueMatchId();
        var match = TftMatch(matchId, T0);
        match.TftParticipants.Add(Board(matchId, account.Puuid, 3));
        db.Matches.Add(match);
        db.LeagueEntries.Add(new LeagueEntry
        {
            RiotAccountId = account.Id,
            QueueType = "RANKED_TFT",
            Tier = RankTier.Platinum,
            Division = RankDivision.III,
            LeaguePoints = 88,
            FetchedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();

        var (client, _) = await server.AdminAsync();
        using var _client = client;

        var detail = await client.GetAsync(new Uri($"/api/matches/{matchId}", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, detail.StatusCode);

        var dashboard = await client.GetFromJsonAsync<JsonElement>(
            new Uri($"/api/riot-accounts/{account.Id}/dashboard", UriKind.Relative));
        Assert.Empty(dashboard.GetProperty("leagueEntries").EnumerateArray());

        var periods = await client.GetFromJsonAsync<List<SeasonResponse>>(
            new Uri($"/api/riot-accounts/{account.Id}/rank/periods", UriKind.Relative));
        Assert.NotNull(periods);
        Assert.All(periods, p => Assert.Equal("lol", p.Game));
    }

    [Fact]
    public async Task Seasons_are_read_and_written_one_game_at_a_time()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var league = await admin.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/api/seasons", UriKind.Relative));
        var tft = await admin.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/api/seasons?game=tft", UriKind.Relative));

        Assert.NotNull(league);
        Assert.NotNull(tft);
        Assert.All(league, s => Assert.Equal("lol", s.Game));
        Assert.All(tft, s => Assert.Equal("tft", s.Game));
        Assert.Contains(tft, s => s.Label == "Set 18");

        var unknown = await admin.GetAsync(new Uri("/api/seasons?game=valorant", UriKind.Relative));
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);

        // What a desktop from before TFT sends: League's list, naming no game.
        // It must replace League's and leave TFT's exactly where they were.
        var saved = await admin.PutAsJsonAsync(
            new Uri("/api/seasons", UriKind.Relative),
            league.Select(s => new { label = s.Label, startsAt = s.StartsAt, isPreseason = s.IsPreseason, resetsRank = s.ResetsRank }));
        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);

        var tftAfter = await admin.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/api/seasons?game=tft", UriKind.Relative));
        Assert.Equal(tft, tftAfter);
    }
}
