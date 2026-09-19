using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The game-data schema, against a real SQL Server.
///
/// Worth its own suite because almost nothing here is C#. The cascade paths, the
/// composite keys, nvarchar(max) holding a match payload, and whether the whole
/// thing can even be created — SQL Server refuses two cascading paths between
/// the same pair of tables, and the first attempt at this schema was rejected
/// outright for it. An in-memory provider would have accepted all of it.
///
/// The last test is the one that matters most: a match, two rank readings and
/// the attribution rule, driven through actual rows rather than through
/// fixtures. Foxfire.Core proves the rule is right; this proves the schema can
/// feed it.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class GameSchemaTests(FoxfireServerFixture server)
{
    private const long T0 = 1_700_000_000_000;

    /// <summary>A scope with its own DbContext, the way a request gets one.</summary>
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
            GameName = $"Player{suffix}",
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

    private static Match NewMatch(string matchId, long gameCreation, int queueId = 420) => new()
    {
        MatchId = matchId,
        GameCreation = gameCreation,
        GameDuration = 1669,
        GameMode = "CLASSIC",
        GameType = "MATCHED_GAME",
        QueueId = queueId,
        PlatformId = "NA1",
        RawJson = """{"metadata":{},"info":{}}""",
        FetchedAt = DateTimeOffset.UtcNow
    };

    [Fact]
    public async Task The_seeded_season_is_there()
    {
        // Without any seasons the reset guard cannot fire, and the first January
        // after a server is stood up is exactly when that matters.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var seasons = await db.Seasons.OrderBy(s => s.StartsAt).ToListAsync();

        Assert.NotEmpty(seasons);
        Assert.Contains(seasons, s => s.StartsAt == 1767830400000L && s.ResetsRank);
    }

    [Fact]
    public async Task Two_seasons_cannot_open_at_the_same_instant()
    {
        // The ordering is the whole of how a season is read, and two boundaries
        // at one instant would make it ambiguous.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var startsAt = 1_800_000_000_000L + Random.Shared.Next(1, 1_000_000);
        db.Seasons.Add(new RankedSeason { Label = "First", StartsAt = startsAt, ResetsRank = true });
        await db.SaveChangesAsync();

        db.Seasons.Add(new RankedSeason { Label = "Clash", StartsAt = startsAt, ResetsRank = true });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task A_full_match_payload_survives_a_round_trip()
    {
        // nvarchar(max), asserted rather than assumed. A real payload is 100-200
        // KB, which is past every length short of max.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        // Built by concatenation rather than as a raw literal: the JSON ends in
        // three closing braces, which an interpolated raw string reads as its own
        // delimiters unless the dollars outnumber them.
        var big = "{\"info\":{\"participants\":[{\"filler\":\"" + new string('x', 250_000) + "\"}]}}";
        var matchId = UniqueMatchId();

        var match = NewMatch(matchId, T0);
        match.RawJson = big;
        db.Matches.Add(match);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var stored = await db.Matches.SingleAsync(m => m.MatchId == matchId);
        Assert.Equal(big.Length, stored.RawJson.Length);
    }

    [Fact]
    public async Task A_match_is_stored_once_and_shared_by_everybody_in_it()
    {
        // The property that makes storage sublinear in the size of a community,
        // and why a friend linking an account often costs almost no Riot calls.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var matchId = UniqueMatchId();
        db.Matches.Add(NewMatch(matchId, T0));

        for (var i = 0; i < 10; i++)
        {
            db.MatchParticipants.Add(new MatchParticipant
            {
                MatchId = matchId,
                Puuid = $"puuid-{i}-{Guid.NewGuid():N}",
                TeamId = i < 5 ? 100 : 200,
                Win = i < 5,
                ChampionId = 100 + i
            });
        }

        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        Assert.Equal(10, await db.MatchParticipants.CountAsync(p => p.MatchId == matchId));
        Assert.Equal(1, await db.Matches.CountAsync(m => m.MatchId == matchId));
    }

    [Fact]
    public async Task One_player_appears_once_in_a_match()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var matchId = UniqueMatchId();
        var puuid = $"puuid-{Guid.NewGuid():N}";

        db.Matches.Add(NewMatch(matchId, T0));
        db.MatchParticipants.Add(new MatchParticipant { MatchId = matchId, Puuid = puuid, TeamId = 100, Win = true, ChampionId = 112 });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        db.MatchParticipants.Add(new MatchParticipant { MatchId = matchId, Puuid = puuid, TeamId = 200, Win = false, ChampionId = 1 });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [Fact]
    public async Task Deleting_a_match_takes_its_participants_with_it()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var matchId = UniqueMatchId();
        db.Matches.Add(NewMatch(matchId, T0));
        db.MatchParticipants.Add(new MatchParticipant { MatchId = matchId, Puuid = $"p-{Guid.NewGuid():N}", TeamId = 100, Win = true, ChampionId = 112 });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        await db.Matches.Where(m => m.MatchId == matchId).ExecuteDeleteAsync();

        Assert.Equal(0, await db.MatchParticipants.CountAsync(p => p.MatchId == matchId));
    }

    [Fact]
    public async Task Deleting_a_match_clears_a_manual_reading_rather_than_deleting_it()
    {
        // A hand-entered LP figure is stored as a reading that names its game.
        // Losing the game must not lose the reading — it is somebody's typed-in
        // answer, and it still describes where they were at that moment.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        var matchId = UniqueMatchId();
        db.Matches.Add(NewMatch(matchId, T0));

        var reading = new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            Tier = RankTier.Gold,
            Division = RankDivision.II,
            LeaguePoints = 41,
            LadderPosition = 1441,
            Source = "manual",
            CapturedAt = T0 + 1000,
            MatchId = matchId
        };

        db.RankSnapshots.Add(reading);
        await db.SaveChangesAsync();

        // Loaded so EF can null the reference: the constraint is NO ACTION,
        // because SQL Server allows only one cascade path into this table and
        // the account already has it.
        var match = await db.Matches.Include(m => m.Participants).SingleAsync(m => m.MatchId == matchId);
        await db.RankSnapshots.Where(r => r.MatchId == matchId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.MatchId, (string?)null));
        db.Matches.Remove(match);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var kept = await db.RankSnapshots.SingleAsync(r => r.Id == reading.Id);
        Assert.Null(kept.MatchId);
        Assert.Equal(41, kept.LeaguePoints);
    }

    [Fact]
    public async Task Deleting_a_riot_account_takes_its_readings_and_its_sync_state()
    {
        // Its own data goes; the shared games stay. A match belongs to the
        // server, not to whoever happened to be tracked in it.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        var matchId = UniqueMatchId();

        db.Matches.Add(NewMatch(matchId, T0));
        db.RankSnapshots.Add(new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            Source = "lcu",
            CapturedAt = T0
        });
        db.SyncStates.Add(new SyncState { RiotAccountId = account.Id, BackfillTarget = 200 });
        db.LeagueEntries.Add(new LeagueEntry { RiotAccountId = account.Id, QueueType = RankedQueue.SoloDuo.RiotName(), Tier = RankTier.Gold });
        db.RetiredPuuids.Add(new RetiredPuuid { RiotAccountId = account.Id, Puuid = "old-puuid", RetiredAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        await db.RiotAccounts.Where(a => a.Id == account.Id).ExecuteDeleteAsync();

        Assert.Equal(0, await db.RankSnapshots.CountAsync(r => r.RiotAccountId == account.Id));
        Assert.Equal(0, await db.SyncStates.CountAsync(s => s.RiotAccountId == account.Id));
        Assert.Equal(0, await db.LeagueEntries.CountAsync(l => l.RiotAccountId == account.Id));
        Assert.Equal(0, await db.RetiredPuuids.CountAsync(r => r.RiotAccountId == account.Id));
        Assert.Equal(1, await db.Matches.CountAsync(m => m.MatchId == matchId));
    }

    [Fact]
    public async Task A_stored_reading_becomes_the_shape_the_rule_takes()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        var row = new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = RankedQueue.Flex.RiotName(),
            Tier = RankTier.Emerald,
            Division = RankDivision.II,
            LeaguePoints = 20,
            LadderPosition = 2220,
            Source = "league_v4",
            CapturedAt = T0
        };

        db.RankSnapshots.Add(row);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var reading = (await db.RankSnapshots.SingleAsync(r => r.Id == row.Id)).ToReading();

        Assert.Equal(RankedQueue.Flex, reading.Queue);
        Assert.Equal(RankTier.Emerald, reading.Tier);
        Assert.Equal(RankDivision.II, reading.Division);
        Assert.Equal(2220, reading.LadderPosition);
        Assert.Equal(T0, reading.CapturedAt);
    }

    [Fact]
    public async Task A_tier_this_server_has_never_heard_of_reads_back_as_unranked()
    {
        // Riot added EMERALD in 2023 and shifted everybody's tier to make room.
        // When they do it again, the rows arrive before the code does — so what
        // matters is what happens to the reads in between.
        //
        // The answer has to be "nothing dramatic", because a value converter is
        // the worst place in the stack to throw: it runs during materialization,
        // so a single unreadable row would not produce a single unreadable
        // value, it would fail the whole rank history with a stack trace about
        // expression compilation.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);

        var row = new RankSnapshot
        {
            RiotAccountId = account.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            Tier = RankTier.Gold,
            Division = RankDivision.II,
            LeaguePoints = 20,
            Source = "league_v4",
            CapturedAt = T0
        };

        db.RankSnapshots.Add(row);
        await db.SaveChangesAsync();

        // Straight past EF, because the whole point is a value the model cannot
        // produce. This is the row a future Riot writes and this build reads.
        await db.Database.ExecuteSqlAsync(
            $"UPDATE RankSnapshots SET Tier = 'ASCENDANT' WHERE Id = {row.Id}");

        db.ChangeTracker.Clear();

        var read = await db.RankSnapshots.SingleAsync(r => r.Id == row.Id);

        Assert.Null(read.Tier);
        Assert.Null(Ladder.LadderPosition(read.ToReading()));

        // And the rest of the row survives, which is the part that makes this a
        // blank chip rather than a lost reading.
        Assert.Equal(RankDivision.II, read.Division);
        Assert.Equal(20, read.LeaguePoints);

        // The seam this leaves, asserted rather than left to be discovered: the
        // column is not null, so SQL still counts the row, and only the
        // materialized value is null.
        Assert.True(await db.RankSnapshots.AnyAsync(r => r.Id == row.Id && r.Tier != null));
    }

    [Fact]
    public async Task Attribution_runs_end_to_end_over_stored_rows()
    {
        // The whole path, through real rows rather than fixtures: two readings,
        // one ranked game between them, and the LP figure written out. Core
        // proves the rule; this proves the schema can feed it and store what it
        // decided.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var account = await AddAccountAsync(db);
        var solo = RankedQueue.SoloDuo;
        var matchId = UniqueMatchId();

        db.Matches.Add(NewMatch(matchId, T0 + 500, solo.QueueId()));
        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = account.Puuid,
            TeamId = 100,
            Win = true,
            ChampionId = 112,
            GameEndedInEarlySurrender = false
        });

        foreach (var (lp, position, at) in new[] { (20, 1420, T0), (41, 1441, T0 + 1000) })
        {
            db.RankSnapshots.Add(new RankSnapshot
            {
                RiotAccountId = account.Id,
                QueueType = solo.RiotName(),
                Tier = RankTier.Gold,
                Division = RankDivision.II,
                LeaguePoints = lp,
                LadderPosition = position,
                Source = "lcu",
                CapturedAt = at
            });
        }

        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var readings = await db.RankSnapshots
            .Where(r => r.RiotAccountId == account.Id && r.QueueType == solo.RiotName())
            .OrderBy(r => r.CapturedAt)
            .ToListAsync();

        var candidates = await db.MatchParticipants
            .Where(p => p.Puuid == account.Puuid)
            .Join(db.Matches, p => p.MatchId, m => m.MatchId, (p, m) => new RankedMatch(
                m.MatchId,
                m.GameCreation,
                m.QueueId ?? 0,
                p.GameEndedInEarlySurrender))
            .ToListAsync();

        var seasons = await db.Seasons.OrderBy(s => s.StartsAt)
            .Select(s => s.ToDomain())
            .ToListAsync();

        var attributed = RankAttribution.Replay(
            [.. readings.Select(r => r.ToReading())],
            candidates,
            seasons);

        Assert.Single(attributed);
        Assert.Equal(matchId, attributed[0].MatchId);
        Assert.Equal(21, attributed[0].LpDelta);

        // And it stores.
        db.MatchRanks.Add(new MatchRank
        {
            MatchId = attributed[0].MatchId,
            RiotAccountId = account.Id,
            QueueType = attributed[0].Queue.RiotName(),
            TierBefore = attributed[0].TierBefore,
            DivisionBefore = attributed[0].DivisionBefore,
            LpBefore = attributed[0].LpBefore,
            TierAfter = attributed[0].TierAfter,
            DivisionAfter = attributed[0].DivisionAfter,
            LpAfter = attributed[0].LpAfter,
            LpDelta = attributed[0].LpDelta,
            IsPromotion = attributed[0].IsPromotion,
            IsDemotion = attributed[0].IsDemotion
        });

        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var stored = await db.MatchRanks.SingleAsync(r => r.MatchId == matchId && r.RiotAccountId == account.Id);
        Assert.Equal(21, stored.LpDelta);
        Assert.False(stored.IsPromotion);
    }
}
