using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Endpoints;
using Foxfire.Api.Features.Reads;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// What the screens read, and who is allowed to write it.
///
/// The queries are ports of the desktop's, so what is being checked is that the
/// port kept the behaviour — team totals as the denominator for damage share,
/// remakes excluded from champion numbers, paging over the filtered set — rather
/// than that SQL works.
///
/// The permission tests are the other half. Everything on a Foxfire server reads
/// openly and writes only to the account's owner, and both halves of that are
/// easy to get wrong in the direction nobody notices.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class ReadTests(FoxfireServerFixture server)
{
    private static readonly long T0 = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 7_200_000;

    private AsyncServiceScope Scope() => server.Services.CreateAsyncScope();

    private static string UniqueMatchId() => $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}";

    private static async Task<RiotAccount> AddAccountAsync(FoxfireDbContext db, Guid? ownerId = null)
    {
        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = $"Player{Guid.NewGuid().ToString("N")[..8]}",
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

    /// <summary>
    /// A stored game with a full team, so the aggregates have something to
    /// divide by.
    /// </summary>
    private static async Task<string> AddMatchAsync(
        FoxfireDbContext db,
        string puuid,
        long gameCreation,
        int queueId = 420,
        bool win = true,
        bool remake = false,
        int championId = 64,
        int kills = 8,
        int damage = 20_000)
    {
        var matchId = UniqueMatchId();

        db.Matches.Add(new Match
        {
            MatchId = matchId,
            GameCreation = gameCreation,
            GameDuration = 1800,
            GameMode = "CLASSIC",
            GameType = "MATCHED_GAME",
            QueueId = queueId,
            PlatformId = "NA1",
            RawJson = "{}",
            FetchedAt = DateTimeOffset.UtcNow
        });

        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = puuid,
            GameName = "Me",
            TagLine = "NA1",
            TeamId = 100,
            Win = win,
            ChampionId = championId,
            ChampionName = "Lee Sin",
            ChampLevel = 16,
            Kills = kills,
            Deaths = 4,
            Assists = 6,
            GoldEarned = 13_000,
            Cs = 190,
            DamageDealtToChampions = damage,
            DamageTaken = 24_000,
            Items = { 3153, 3006, 6672, 3031, 3072, 0, 3363 },
            PerksJson = """{"statPerks":{"defense":5002}}""",
            TeamPosition = "JUNGLE",
            LargestMultiKill = 2,
            GameEndedInEarlySurrender = remake,
            RoleBoundItem = 0
        });

        // Four team-mates and five opponents, so team totals are a real
        // denominator rather than the player's own numbers.
        for (var i = 1; i < 10; i++)
        {
            db.MatchParticipants.Add(new MatchParticipant
            {
                MatchId = matchId,
                Puuid = $"stranger-{matchId}-{i}",
                TeamId = i < 5 ? 100 : 200,
                Win = i < 5 ? win : !win,
                ChampionId = 100 + i,
                Kills = 3,
                Deaths = 5,
                Assists = 4,
                Cs = 150,
                DamageDealtToChampions = 15_000,
                GameEndedInEarlySurrender = remake,
                RoleBoundItem = 0
            });
        }

        await db.SaveChangesAsync();
        return matchId;
    }

    [Fact]
    public async Task A_match_row_carries_its_team_totals_and_its_LP()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<MatchReads>();

        var account = await AddAccountAsync(db);
        var matchId = await AddMatchAsync(db, account.Puuid, T0);

        db.MatchRanks.Add(new MatchRank
        {
            MatchId = matchId,
            RiotAccountId = account.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            TierBefore = RankTier.Gold,
            DivisionBefore = RankDivision.II,
            LpBefore = 41,
            TierAfter = RankTier.Gold,
            DivisionAfter = RankDivision.II,
            LpAfter = 62,
            LpDelta = 21
        });

        await db.SaveChangesAsync();

        var rows = await reads.MatchListAsync(account.Puuid, account.Id, 20, 0, null);
        var row = Assert.Single(rows);

        // Eight of my kills plus four team-mates on three each.
        Assert.Equal(20, row.TeamKills);
        Assert.Equal(80_000, row.TeamDamage);

        Assert.Equal([3153, 3006, 6672, 3031, 3072, 0, 3363], row.Items);
        Assert.NotNull(row.Perks);

        Assert.NotNull(row.Rank);
        Assert.Equal(21, row.Rank.LpDelta);
        Assert.False(row.HasManualRank);
    }

    [Fact]
    public async Task Somebody_elses_games_have_no_LP_on_your_row()
    {
        // The LP figure belongs to an account, not to a match: two people in the
        // same game moved different amounts, and one of them may not be tracked
        // here at all.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<MatchReads>();

        var mine = await AddAccountAsync(db);
        var theirs = await AddAccountAsync(db);
        var matchId = await AddMatchAsync(db, mine.Puuid, T0);

        db.MatchParticipants.Add(new MatchParticipant
        {
            MatchId = matchId,
            Puuid = theirs.Puuid,
            TeamId = 200,
            ChampionId = 55,
            Kills = 2,
            Deaths = 9,
            Assists = 1,
            RoleBoundItem = 0
        });

        db.MatchRanks.Add(new MatchRank
        {
            MatchId = matchId,
            RiotAccountId = mine.Id,
            QueueType = RankedQueue.SoloDuo.RiotName(),
            LpDelta = 21
        });

        await db.SaveChangesAsync();

        var theirRow = Assert.Single(await reads.MatchListAsync(theirs.Puuid, theirs.Id, 20, 0, null));
        Assert.Null(theirRow.Rank);

        var myRow = Assert.Single(await reads.MatchListAsync(mine.Puuid, mine.Id, 20, 0, null));
        Assert.NotNull(myRow.Rank);
    }

    [Fact]
    public async Task Paging_happens_over_the_filtered_set()
    {
        // Filtering after paging is what yields short, uneven pages — the reason
        // the queue predicate sits on the outer query.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<MatchReads>();

        var account = await AddAccountAsync(db);

        for (var i = 0; i < 3; i++)
        {
            await AddMatchAsync(db, account.Puuid, T0 + (i * 600_000), queueId: 420);
            await AddMatchAsync(db, account.Puuid, T0 + (i * 600_000) + 1000, queueId: 450);
        }

        var ranked = await reads.MatchListAsync(account.Puuid, account.Id, 2, 0, 420);
        Assert.Equal(2, ranked.Count);
        Assert.All(ranked, r => Assert.Equal(420, r.QueueId));

        var second = await reads.MatchListAsync(account.Puuid, account.Id, 2, 2, 420);
        Assert.Single(second);
        Assert.Equal(420, second[0].QueueId);

        // Newest first, the way history reads.
        Assert.True(ranked[0].GameCreation > ranked[1].GameCreation);

        // The total beside a page counts the same filtered set the page is
        // taken from — the two are written separately, so this holds them together.
        Assert.Equal(3, await reads.MatchCountAsync(account.Puuid, 420));
        Assert.Equal(6, await reads.MatchCountAsync(account.Puuid, null));
    }

    [Fact]
    public async Task A_match_detail_shows_both_teams()
    {
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<MatchReads>();

        var account = await AddAccountAsync(db);
        var matchId = await AddMatchAsync(db, account.Puuid, T0);

        var detail = await reads.MatchDetailAsync(matchId);

        Assert.NotNull(detail);
        Assert.Equal(10, detail.Participants.Count);
        Assert.Equal(5, detail.Participants.Count(p => p.TeamId == 100));
        Assert.Null(await reads.MatchDetailAsync("NA1_nothing"));
    }

    [Fact]
    public async Task Champion_stats_leave_remakes_out()
    {
        // A game voided after two minutes is not evidence about how a champion
        // performs, and counting them is what made the desktop's numbers differ
        // from op.gg's.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<MatchReads>();

        var account = await AddAccountAsync(db);

        await AddMatchAsync(db, account.Puuid, T0, win: true);
        await AddMatchAsync(db, account.Puuid, T0 + 1000, win: false);
        await AddMatchAsync(db, account.Puuid, T0 + 2000, win: false, remake: true);

        var stats = Assert.Single(await reads.ChampionStatsAsync(account.Puuid, null, null, null));

        Assert.Equal(2, stats.Games);
        Assert.Equal(1, stats.Wins);

        // My 20,000 out of the team's 80,000, meaned per game rather than pooled:
        // a share is already normalised, so pooling would let one long game
        // outvote several short ones.
        Assert.NotNull(stats.DamageShare);
        Assert.Equal(0.25, stats.DamageShare.Value, 3);
    }

    [Fact]
    public async Task Champion_stats_are_scoped_to_a_period()
    {
        // Unbounded, this blends every year into one win rate with no way to tell
        // them apart — a champion abandoned two seasons ago drags on the number.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<MatchReads>();

        var account = await AddAccountAsync(db);

        await AddMatchAsync(db, account.Puuid, T0 - 86_400_000, championId: 64);
        await AddMatchAsync(db, account.Puuid, T0, championId: 64);

        var recent = Assert.Single(await reads.ChampionStatsAsync(account.Puuid, null, T0 - 3600_000, null));
        Assert.Equal(1, recent.Games);

        var all = Assert.Single(await reads.ChampionStatsAsync(account.Puuid, null, null, null));
        Assert.Equal(2, all.Games);
    }

    [Fact]
    public async Task Hand_entering_LP_produces_a_figure_and_clearing_it_removes_it()
    {
        // The whole point of storing an entry as a reading rather than as an
        // attribution: the ordinary machinery derives the figure from it, and
        // deriving it again after a clear is what retracts it.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var editor = scope.ServiceProvider.GetRequiredService<ManualRankEditor>();

        var account = await AddAccountAsync(db);
        var matchId = await AddMatchAsync(db, account.Puuid, T0);

        var offered = await editor.EditableAsync(account.Id, account.Puuid, RankedQueue.SoloDuo);
        Assert.Contains(offered, m => m.MatchId == matchId);

        var problem = await editor.SaveAsync(
            account.Id,
            account.Puuid,
            RankedQueue.SoloDuo,
            [new ManualRankEdit(matchId, new ManualRank(RankTier.Gold, RankDivision.II, 62),
                new ManualRank(RankTier.Gold, RankDivision.II, 41))]);

        Assert.Null(problem);

        db.ChangeTracker.Clear();
        var written = await db.MatchRanks.AsNoTracking()
            .FirstOrDefaultAsync(r => r.MatchId == matchId && r.RiotAccountId == account.Id);

        Assert.NotNull(written);
        Assert.Equal(21, written.LpDelta);

        Assert.True(await editor.ClearAsync(account.Id, account.Puuid, matchId));

        db.ChangeTracker.Clear();
        Assert.False(await db.MatchRanks.AnyAsync(r => r.MatchId == matchId && r.RiotAccountId == account.Id));
        Assert.False(await db.RankSnapshots.AnyAsync(r => r.MatchId == matchId));
    }

    [Fact]
    public async Task A_rank_that_could_not_exist_is_refused_rather_than_stored()
    {
        // Attribution silently skips a reading it cannot place on the ladder, so
        // an unchecked bad value would save without error and then do nothing —
        // the most confusing outcome available.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var editor = scope.ServiceProvider.GetRequiredService<ManualRankEditor>();

        var account = await AddAccountAsync(db);
        var matchId = await AddMatchAsync(db, account.Puuid, T0);

        var problem = await editor.SaveAsync(
            account.Id,
            account.Puuid,
            RankedQueue.SoloDuo,
            [new ManualRankEdit(matchId, new ManualRank(RankTier.Gold, RankDivision.II, 140), null)]);

        Assert.NotNull(problem);
        Assert.Contains("LP", problem, StringComparison.Ordinal);

        db.ChangeTracker.Clear();
        Assert.False(await db.RankSnapshots.AnyAsync(r => r.MatchId == matchId));
    }

    [Fact]
    public async Task A_game_on_another_ladder_cannot_be_given_a_figure()
    {
        // The edit names a queue, and a flex game is not a solo game. Without
        // this the reading would land on the wrong series and move somebody's
        // other ladder.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var editor = scope.ServiceProvider.GetRequiredService<ManualRankEditor>();

        var account = await AddAccountAsync(db);
        var flexMatch = await AddMatchAsync(db, account.Puuid, T0, queueId: 440);

        var problem = await editor.SaveAsync(
            account.Id,
            account.Puuid,
            RankedQueue.SoloDuo,
            [new ManualRankEdit(flexMatch, new ManualRank(RankTier.Gold, RankDivision.II, 62), null)]);

        Assert.NotNull(problem);
    }

    [Fact]
    public async Task The_rank_graph_marks_crossings_but_not_resets()
    {
        // A reset is not a demotion. It is the one movement on the graph that
        // describes nothing anybody did.
        await using var scope = Scope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var reads = scope.ServiceProvider.GetRequiredService<RankReads>();

        var account = await AddAccountAsync(db);
        var queue = RankedQueue.SoloDuo.RiotName();

        foreach (var (tier, division, lp, at) in new[]
                 {
                     (RankTier.Silver, RankDivision.I, 88, T0),
                     (RankTier.Gold, RankDivision.IV, 12, T0 + 60_000),
                     (RankTier.Gold, RankDivision.IV, 40, T0 + 120_000)
                 })
        {
            db.RankSnapshots.Add(new RankSnapshot
            {
                RiotAccountId = account.Id,
                QueueType = queue,
                Tier = tier,
                Division = division,
                LeaguePoints = lp,
                LadderPosition = Ladder.LadderPosition(new Rank(tier, division, lp)),
                Source = RankSources.LeagueV4,
                CapturedAt = at
            });
        }

        await db.SaveChangesAsync();

        var history = await reads.HistoryAsync(account.Id, queue, "all");

        Assert.Equal(3, history.Snapshots.Count);

        var milestone = Assert.Single(history.Milestones);
        Assert.Equal("promotion", milestone.Movement);
        Assert.Equal("GOLD", milestone.Tier);

        // Stamped so the renderer never needs the season table.
        Assert.All(history.Snapshots, s => Assert.NotNull(s.SeasonId));
    }

    [Fact]
    public async Task Anybody_signed_in_can_read_anybody_elses_history()
    {
        // The decision the whole design rests on. A friend's games are as
        // readable as your own, and the screens need no idea whose they are.
        var (adminClient, admin) = await server.AdminAsync();

        Guid accountId;
        await using (var scope = Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var account = await AddAccountAsync(db, admin.User.Id);
            accountId = account.Id;
            await AddMatchAsync(db, account.Puuid, T0);
        }

        var stranger = server.Client();
        // Unique, because Identity enforces unique usernames whatever this
        // server intends by them — see the note in Program.cs.
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var session = await server.RegisterAsync(
            stranger, $"Onlooker{suffix}", $"onlooker-{suffix}@example.com");

        FoxfireServerFixture.Authenticated(stranger, session);

        var response = await stranger.GetAsync(
            new Uri($"/api/riot-accounts/{accountId}/matches", UriKind.Relative));

        response.EnsureSuccessStatusCode();

        var rows = await response.Content.ReadFromJsonAsync<Page<MatchSummaryResponse>>();
        Assert.NotNull(rows);
        Assert.Single(rows.Items);
        Assert.Equal(1, rows.Total);

        // Reading is open; writing is not.
        var write = await stranger.PostAsJsonAsync(
            new Uri($"/api/riot-accounts/{accountId}/rank/manual", UriKind.Relative),
            new { queueType = "RANKED_SOLO_5x5", edits = Array.Empty<object>() });

        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);

        adminClient.Dispose();
        stranger.Dispose();
    }

    [Fact]
    public async Task One_game_reads_as_the_row_the_history_shows_for_that_player()
    {
        // What a link to a game opens on: the player's own row, LP and all,
        // rather than a page of history to find it in.
        var (client, admin) = await server.AdminAsync();
        using var _ = client;

        Guid accountId;
        string matchId;
        await using (var scope = Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var account = await AddAccountAsync(db, admin.User.Id);
            accountId = account.Id;

            await AddMatchAsync(db, account.Puuid, T0 - 60_000);
            matchId = await AddMatchAsync(db, account.Puuid, T0, championId: 103);
            await AddMatchAsync(db, account.Puuid, T0 + 60_000);

            db.MatchRanks.Add(new MatchRank
            {
                MatchId = matchId,
                RiotAccountId = account.Id,
                QueueType = RankedQueue.SoloDuo.RiotName(),
                TierBefore = RankTier.Silver,
                DivisionBefore = RankDivision.I,
                LpBefore = 80,
                TierAfter = RankTier.Silver,
                DivisionAfter = RankDivision.I,
                LpAfter = 98,
                LpDelta = 18
            });
            await db.SaveChangesAsync();
        }

        var row = await client.GetFromJsonAsync<MatchSummaryResponse>(
            new Uri($"/api/riot-accounts/{accountId}/matches/{matchId}", UriKind.Relative));

        Assert.NotNull(row);
        Assert.Equal(matchId, row.MatchId);
        Assert.Equal(103, row.ChampionId);
        Assert.Equal(18, row.Rank?.LpDelta);

        var missing = await client.GetAsync(
            new Uri($"/api/riot-accounts/{accountId}/matches/NA1_0", UriKind.Relative));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Only_an_admin_may_move_a_season_boundary()
    {
        // One wrong resetsRank silently rewrites every member's LP history,
        // because attribution skips reset boundaries and is replayed from
        // scratch. It does not fail; it quietly produces different numbers.
        var member = server.Client();
        var suffix = Guid.NewGuid().ToString("N")[..8];
        var session = await server.RegisterAsync(
            member, $"Member{suffix}", $"member-{suffix}@example.com");

        FoxfireServerFixture.Authenticated(member, session);

        var refused = await member.PutAsJsonAsync(
            new Uri("/api/seasons", UriKind.Relative),
            new[] { new { label = "Season 2027", startsAt = 1_799_000_000_000L, isPreseason = false, resetsRank = true } });

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);

        var (admin, _) = await server.AdminAsync();

        var existing = await admin.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/api/seasons", UriKind.Relative));
        Assert.NotNull(existing);
        Assert.NotEmpty(existing);

        var duplicate = existing.Select(s => new
        {
            label = s.Label,
            startsAt = existing[0].StartsAt,
            isPreseason = s.IsPreseason,
            resetsRank = s.ResetsRank
        }).ToList();

        if (duplicate.Count > 1)
        {
            var rejected = await admin.PutAsJsonAsync(new Uri("/api/seasons", UriKind.Relative), duplicate);
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        }

        // A real edit, then put back exactly what was there. The server is shared
        // across the suite and the seeded boundary is something other tests read.
        var added = existing
            .Select(s => new { label = s.Label, startsAt = s.StartsAt, isPreseason = s.IsPreseason, resetsRank = s.ResetsRank })
            .Append(new { label = "Season 2027", startsAt = 1_799_000_000_000L, isPreseason = false, resetsRank = true })
            .ToList();

        var saved = await admin.PutAsJsonAsync(new Uri("/api/seasons", UriKind.Relative), added);
        Assert.Equal(HttpStatusCode.NoContent, saved.StatusCode);

        var after = await admin.GetFromJsonAsync<List<SeasonResponse>>(new Uri("/api/seasons", UriKind.Relative));
        Assert.NotNull(after);
        Assert.Equal(existing.Count + 1, after.Count);

        var restored = await admin.PutAsJsonAsync(
            new Uri("/api/seasons", UriKind.Relative),
            existing.Select(s => new { label = s.Label, startsAt = s.StartsAt, isPreseason = s.IsPreseason, resetsRank = s.ResetsRank }));

        Assert.Equal(HttpStatusCode.NoContent, restored.StatusCode);

        member.Dispose();
        admin.Dispose();
    }

    [Fact]
    public async Task A_never_synced_account_still_has_a_dashboard()
    {
        // Linked but not yet fetched is an ordinary state — it is what every
        // account looks like for the first few minutes.
        var (admin, session) = await server.AdminAsync();

        Guid accountId;
        await using (var scope = Scope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            accountId = (await AddAccountAsync(db, session.User.Id)).Id;
        }

        var dashboard = await admin.GetFromJsonAsync<DashboardResponse>(
            new Uri($"/api/riot-accounts/{accountId}/dashboard", UriKind.Relative));

        Assert.NotNull(dashboard);
        Assert.True(dashboard.Account.IsMine);
        Assert.Empty(dashboard.LeagueEntries);
        Assert.Null(dashboard.SyncState);
        Assert.Equal(0, dashboard.StoredMatches);

        admin.Dispose();
    }
}
