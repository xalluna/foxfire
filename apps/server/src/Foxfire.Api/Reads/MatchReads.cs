using System.Text.Json;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Reads;

/// <summary>
/// The shared replay of a game, as a match row advertises one.
///
/// Two fields and no URL. A download URL is a credential and is minted when
/// somebody asks for one, not printed on every row of a page of history — and
/// the patch is the part the row actually needs, because whether this viewer
/// can play it depends on which League installs are on their machine.
/// </summary>
public sealed record MatchSharedReplay(string? Patch, long? FileBytes);

/// <summary>What one game was worth, when it could be worked out.</summary>
public sealed record MatchRankSummary(
    int LpDelta,
    string? TierBefore,
    string? RankBefore,
    string? TierAfter,
    string? RankAfter,
    bool IsPromotion,
    bool IsDemotion);

/// <summary>
/// The same thing, one step before the wire.
///
/// It exists because the tiers are spelled for the desktop by calling
/// RiotName, and this is read inside an EF projection — where a method call is
/// not a method call but something SQL Server is asked to perform. So the
/// query materializes the types and the spelling happens afterwards, in
/// memory, where it is an ordinary method again.
/// </summary>
internal sealed record MatchRankRow(
    int LpDelta,
    RankTier? TierBefore,
    RankDivision? RankBefore,
    RankTier? TierAfter,
    RankDivision? RankAfter,
    bool IsPromotion,
    bool IsDemotion)
{
    public MatchRankSummary ToWire() =>
        new(LpDelta,
            TierBefore?.RiotName(),
            RankBefore?.RiotName(),
            TierAfter?.RiotName(),
            RankAfter?.RiotName(),
            IsPromotion,
            IsDemotion);
}

/// <summary>
/// One row of match history.
///
/// Shaped as the desktop's MatchSummary, field for field, because the renderer
/// that draws it is the same renderer. Two fields are missing and deliberately
/// so: recordingId and replayId are about files on one machine, and no server
/// can answer them. The desktop fills those from its own SQLite after this
/// arrives.
/// </summary>
public sealed record MatchSummaryResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    string? GameMode,
    int? QueueId,
    bool Win,
    int ChampionId,
    string? ChampionName,
    int? ChampLevel,
    int Kills,
    int Deaths,
    int Assists,
    int? Cs,
    int? GoldEarned,
    int? DamageDealtToChampions,
    int? LargestMultiKill,
    IReadOnlyList<int> Items,
    int RoleBoundItem,
    int? Summoner1Id,
    int? Summoner2Id,
    JsonElement? Perks,
    string? TeamPosition,
    int TeamKills,
    int TeamDamage,
    bool IsRemake,
    MatchRankSummary? Rank,
    bool HasManualRank,
    MatchSharedReplay? SharedReplay);

/// <summary>One player's line, as the match detail screen draws it.</summary>
public sealed record MatchParticipantResponse(
    string Puuid,
    string? GameName,
    string? TagLine,
    int TeamId,
    bool Win,
    int ChampionId,
    string? ChampionName,
    int? ChampLevel,
    int Kills,
    int Deaths,
    int Assists,
    int? GoldEarned,
    int? Cs,
    int? DamageDealtToChampions,
    int? DamageTaken,
    IReadOnlyList<int> Items,
    int RoleBoundItem,
    int? Summoner1Id,
    int? Summoner2Id,
    JsonElement? Perks,
    string? TeamPosition,
    int? LargestMultiKill);

/// <summary>A whole game, both teams.</summary>
public sealed record MatchDetailResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    string? GameMode,
    string? GameType,
    int? QueueId,
    IReadOnlyList<MatchParticipantResponse> Participants);

/// <summary>
/// A game a recording might be of, as far as the server can narrow it.
/// </summary>
/// <param name="ChampionIds">
/// All ten, in no particular order. The fingerprint counts how many of them the
/// recording's own live roster saw, so it is the set that matters and not the
/// order.
/// </param>
public sealed record BindCandidateResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    IReadOnlyList<int> ChampionIds,
    int? SelfChampionId);

/// <summary>Per-champion performance, aggregated over stored games.</summary>
public sealed record ChampionStatsResponse(
    int ChampionId,
    int Games,
    int Wins,
    int Kills,
    int Deaths,
    int Assists,
    int Cs,
    int DamageToChampions,
    int DurationSeconds,
    double? DamageShare,
    double? KillParticipation);

/// <summary>
/// Everything the history and champion screens read.
///
/// A port of the desktop's matches.repo, query by query, and the comments that
/// explain why a query is shaped the way it is came with it — each of those was
/// written against something that had been observed going wrong.
///
/// The one structural difference is the account. On the desktop every query
/// resolves the account inline from the puuid, because an ad-hoc search has no
/// account and the correlated subquery yields null for it. Here the account is
/// passed in, since the caller already knows whose history it asked for, and a
/// null id produces the same no-LP result by the same logic.
/// </summary>
public sealed class MatchReads(FoxfireDbContext db)
{
    /// <summary>
    /// A page of match history for one player.
    ///
    /// Selects the full per-row stat set rather than the bare minimum: every
    /// field is already on disk, so a denser row costs one query rather than any
    /// additional Riot traffic. Team kills and damage are folded in so kill
    /// participation and damage share can be shown without a round trip per
    /// match.
    ///
    /// The queue filter sits on the outer query so that paging happens over the
    /// filtered set — filtering after paging would yield short, uneven pages —
    /// while the team-totals join stays unfiltered, so the denominator is always
    /// the whole team.
    /// </summary>
    public async Task<IReadOnlyList<MatchSummaryResponse>> MatchListAsync(
        string puuid,
        Guid? riotAccountId,
        int limit,
        int offset,
        int? queueId,
        CancellationToken cancellationToken = default)
    {
        var rows = await db.MatchParticipants
            .AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => queueId == null || x.m.QueueId == queueId)
            .OrderByDescending(x => x.m.GameCreation)
            .Skip(offset)
            .Take(limit)
            .Select(x => new
            {
                x.m,
                x.p,
                TeamKills = db.MatchParticipants
                    .Where(t => t.MatchId == x.p.MatchId && t.TeamId == x.p.TeamId)
                    .Sum(t => (int?)t.Kills) ?? 0,
                TeamDamage = db.MatchParticipants
                    .Where(t => t.MatchId == x.p.MatchId && t.TeamId == x.p.TeamId)
                    .Sum(t => (int?)t.DamageDealtToChampions) ?? 0,
                Rank = db.MatchRanks
                    .Where(r => r.MatchId == x.p.MatchId && r.RiotAccountId == riotAccountId)
                    .Select(r => new MatchRankRow(
                        r.LpDelta, r.TierBefore, r.DivisionBefore, r.TierAfter, r.DivisionAfter,
                        r.IsPromotion, r.IsDemotion))
                    .FirstOrDefault(),

                // Only the row's context menu reads this, to choose between
                // offering an edit and offering to clear one.
                HasManualRank = db.RankSnapshots.Any(s =>
                    s.MatchId == x.p.MatchId
                    && s.Source == "manual"
                    && s.RiotAccountId == riotAccountId),

                // A claim nobody finished is not a replay, so the row must not
                // offer one: UploadedAt is what separates the two.
                SharedReplay = db.SharedReplays
                    .Where(r => r.MatchId == x.p.MatchId && r.UploadedAt != null)
                    .Select(r => new MatchSharedReplay(r.Patch, r.FileBytes))
                    .FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(x => new MatchSummaryResponse(
                x.m.MatchId,
                x.m.GameCreation,
                x.m.GameDuration,
                x.m.GameMode,
                x.m.QueueId,
                x.p.Win,
                x.p.ChampionId,
                x.p.ChampionName,
                x.p.ChampLevel,
                x.p.Kills ?? 0,
                x.p.Deaths ?? 0,
                x.p.Assists ?? 0,
                x.p.Cs,
                x.p.GoldEarned,
                x.p.DamageDealtToChampions,
                x.p.LargestMultiKill,
                Numbers(x.p.ItemsJson),
                x.p.RoleBoundItem,
                x.p.Summoner1Id,
                x.p.Summoner2Id,
                Element(x.p.PerksJson),
                x.p.TeamPosition,
                x.TeamKills,
                x.TeamDamage,
                x.p.GameEndedInEarlySurrender,
                x.Rank?.ToWire(),
                x.HasManualRank,
                x.SharedReplay))
        ];
    }

    public async Task<MatchDetailResponse?> MatchDetailAsync(
        string matchId,
        CancellationToken cancellationToken = default)
    {
        var match = await db.Matches.AsNoTracking()
            .FirstOrDefaultAsync(m => m.MatchId == matchId, cancellationToken);

        if (match is null) return null;

        var participants = await db.MatchParticipants.AsNoTracking()
            .Where(p => p.MatchId == matchId)
            .OrderBy(p => p.TeamId)
            .ThenBy(p => p.Puuid)
            .ToListAsync(cancellationToken);

        return new MatchDetailResponse(
            match.MatchId,
            match.GameCreation,
            match.GameDuration,
            match.GameMode,
            match.GameType,
            match.QueueId,
            [
                .. participants.Select(p => new MatchParticipantResponse(
                    p.Puuid,
                    p.GameName,
                    p.TagLine,
                    p.TeamId,
                    p.Win,
                    p.ChampionId,
                    p.ChampionName,
                    p.ChampLevel,
                    p.Kills ?? 0,
                    p.Deaths ?? 0,
                    p.Assists ?? 0,
                    p.GoldEarned,
                    p.Cs,
                    p.DamageDealtToChampions,
                    p.DamageTaken,
                    Numbers(p.ItemsJson),
                    p.RoleBoundItem,
                    p.Summoner1Id,
                    p.Summoner2Id,
                    Element(p.PerksJson),
                    p.TeamPosition,
                    p.LargestMultiKill))
            ]);
    }

    /// <summary>
    /// Per-champion performance, computed here rather than fetched.
    ///
    /// Remakes are excluded: a game voided after two minutes is not evidence
    /// about how a champion performs, and counting them is what made the
    /// desktop's numbers differ from op.gg's.
    ///
    /// The bounds scope the aggregate to a ranked year. Unbounded, this blends
    /// every year into one win rate with no way to tell them apart — a champion
    /// abandoned two seasons ago still drags on the number. They arrive as epoch
    /// milliseconds rather than as a year, because gameCreation is epoch ms and a
    /// SQL year expression would resolve in UTC while periods are decided in
    /// local time.
    ///
    /// Two different averages, on purpose. Totals are pooled, so the caller's
    /// derived ratios agree with the per-game averages printed beside them.
    /// Shares are meaned per game, because they are already normalised — pooling
    /// them would let one forty-minute game outvote three short ones for a number
    /// meant to describe a typical game.
    /// </summary>
    public async Task<IReadOnlyList<ChampionStatsResponse>> ChampionStatsAsync(
        string puuid,
        int? queueId,
        long? sinceMs,
        long? untilMs,
        CancellationToken cancellationToken = default)
    {
        var rows = await db.MatchParticipants
            .AsNoTracking()
            .Where(p => p.Puuid == puuid && !p.GameEndedInEarlySurrender)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => queueId == null || x.m.QueueId == queueId)
            .Where(x => sinceMs == null || x.m.GameCreation >= sinceMs)
            .Where(x => untilMs == null || x.m.GameCreation < untilMs)
            .Select(x => new
            {
                x.p.ChampionId,
                x.p.Win,
                Kills = x.p.Kills ?? 0,
                Deaths = x.p.Deaths ?? 0,
                Assists = x.p.Assists ?? 0,
                Cs = x.p.Cs ?? 0,
                Damage = x.p.DamageDealtToChampions ?? 0,
                x.m.GameDuration,
                TeamKills = db.MatchParticipants
                    .Where(t => t.MatchId == x.p.MatchId && t.TeamId == x.p.TeamId)
                    .Sum(t => (int?)t.Kills) ?? 0,
                TeamDamage = db.MatchParticipants
                    .Where(t => t.MatchId == x.p.MatchId && t.TeamId == x.p.TeamId)
                    .Sum(t => (int?)t.DamageDealtToChampions) ?? 0
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows
                .GroupBy(r => r.ChampionId)
                .Select(g => new ChampionStatsResponse(
                    g.Key,
                    g.Count(),
                    g.Count(r => r.Win),
                    g.Sum(r => r.Kills),
                    g.Sum(r => r.Deaths),
                    g.Sum(r => r.Assists),
                    g.Sum(r => r.Cs),
                    g.Sum(r => r.Damage),
                    g.Sum(r => r.GameDuration),

                    // A shut-out team contributes nothing rather than a zero, so
                    // the game drops out of the mean instead of dragging it down.
                    // Every game shut out leaves the whole average null, matching
                    // how a single match reports "no data".
                    Mean(g.Where(r => r.TeamDamage > 0).Select(r => (double)r.Damage / r.TeamDamage)),
                    Mean(g.Where(r => r.TeamKills > 0).Select(r => (double)(r.Kills + r.Assists) / r.TeamKills))))
                .OrderByDescending(s => s.Games)
        ];
    }

    /// <summary>
    /// The games that could be the one a recording caught, by time alone.
    ///
    /// Time only. Which of them it actually is comes down to a roster
    /// fingerprint — same champion, ten ids overlapping, clocks within an hour —
    /// and that decision stays on the desktop, where it is already written and
    /// already tested against every awkward case a duo night produces. Sending
    /// the candidates rather than the answer keeps one implementation of it.
    ///
    /// Nor does this say which are already spoken for: a recording is a file on
    /// somebody's disk and no server knows one exists. The desktop crosses those
    /// off against its own table.
    /// </summary>
    public async Task<IReadOnlyList<BindCandidateResponse>> BindCandidatesAsync(
        string puuid,
        long sinceMs,
        long untilMs,
        CancellationToken cancellationToken = default)
    {
        var rows = await db.MatchParticipants
            .AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => x.m.GameCreation >= sinceMs && x.m.GameCreation <= untilMs)
            .Select(x => new
            {
                x.m.MatchId,
                x.m.GameCreation,
                x.m.GameDuration,
                SelfChampionId = (int?)x.p.ChampionId,
                ChampionIds = db.MatchParticipants
                    .Where(all => all.MatchId == x.p.MatchId)
                    .Select(all => all.ChampionId)
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(x => new BindCandidateResponse(
                x.MatchId,
                x.GameCreation,
                x.GameDuration,
                x.ChampionIds,
                x.SelfChampionId))
        ];
    }

    /// <summary>How many of this player's games the server holds.</summary>
    public Task<int> StoredMatchCountAsync(string puuid, CancellationToken cancellationToken = default) =>
        db.MatchParticipants.AsNoTracking().CountAsync(p => p.Puuid == puuid, cancellationToken);

    private static double? Mean(IEnumerable<double> values)
    {
        var list = values.ToList();
        return list.Count == 0 ? null : list.Average();
    }

    private static IReadOnlyList<int> Numbers(string? json) =>
        string.IsNullOrEmpty(json) ? [] : JsonSerializer.Deserialize<int[]>(json) ?? [];

    private static JsonElement? Element(string? json) =>
        string.IsNullOrEmpty(json) ? null : JsonDocument.Parse(json).RootElement.Clone();
}
