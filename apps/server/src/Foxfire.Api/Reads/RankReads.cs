using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Reads;

/// <summary>
/// One reading, as the graph plots it.
/// </summary>
/// <param name="Rank">
/// The division. Named for what the desktop's renderer already calls it, because
/// that renderer draws this — the entity spells it Division, and the translation
/// happens here rather than in twenty components.
/// </param>
/// <param name="SeasonId">
/// Stamped here so the renderer never needs the season table to know where one
/// climb ends and the next begins.
/// </param>
public sealed record RankSnapshotResponse(
    string QueueType,
    string? Tier,
    string? Rank,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    int? LadderPosition,
    string Source,
    long CapturedAt,
    int? SeasonId);

/// <summary>A crossing worth marking on the graph.</summary>
public sealed record RankMilestoneResponse(
    string QueueType,
    string Movement,
    string? Tier,
    string? Rank,
    long CapturedAt);

public sealed record RankHistoryResponse(
    IReadOnlyList<RankSnapshotResponse> Snapshots,
    IReadOnlyList<RankMilestoneResponse> Milestones);

/// <summary>A ranked season, as the pickers show it.</summary>
public sealed record SeasonResponse(int Id, string Label, long StartsAt, bool IsPreseason, bool ResetsRank);

/// <summary>
/// The rank graph, its milestones, and which periods an account has history in.
///
/// A port of the desktop's rankHistoryService, and the shapes it returns are the
/// desktop's shapes — the screens that draw them are the same screens.
/// </summary>
public sealed class RankReads(FoxfireDbContext db, TimeProvider time)
{
    /// <summary>
    /// One ladder's readings over a period, plus the promotions and demotions in it.
    ///
    /// The upper bound is exclusive, so two adjacent ranked years tile without
    /// both claiming a reading that lands on the instant of the boundary.
    /// </summary>
    public async Task<RankHistoryResponse> HistoryAsync(
        Guid riotAccountId,
        string queueType,
        string? range,
        CancellationToken cancellationToken = default)
    {
        var seasons = await SeasonsAsync(cancellationToken);
        var bounds = RankedSeasons.RangeBounds(range, seasons, time.GetUtcNow().ToUnixTimeMilliseconds());

        var rows = await db.RankSnapshots
            .AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId && r.QueueType == queueType)
            .Where(r => bounds.StartMs == null || r.CapturedAt >= bounds.StartMs)
            .Where(r => bounds.EndMs == null || r.CapturedAt < bounds.EndMs)
            .OrderBy(r => r.CapturedAt)
            .ThenBy(r => r.Id)
            .ToListAsync(cancellationToken);

        var snapshots = rows
            .Select(r => new RankSnapshotResponse(
                r.QueueType,
                r.Tier,
                r.Division,
                r.LeaguePoints,
                r.Wins,
                r.Losses,
                r.LadderPosition,
                r.Source,
                r.CapturedAt,
                RankedSeasons.SeasonAt(seasons, r.CapturedAt)?.Id))
            .ToList();

        List<RankMilestoneResponse> milestones = [];

        for (var i = 1; i < rows.Count; i++)
        {
            // A reset is not a demotion. Without this the annual reset draws a
            // fall from wherever somebody finished to wherever they were placed,
            // which is the one movement on the graph that describes nothing
            // anybody did.
            if (RankedSeasons.ResetsBetween(seasons, rows[i - 1].CapturedAt, rows[i].CapturedAt)) continue;

            var movement = Ladder.Movement(rows[i - 1].ToReading(), rows[i].ToReading());
            if (movement == RankMovement.None) continue;

            milestones.Add(new RankMilestoneResponse(
                queueType,
                movement == RankMovement.Promotion ? "promotion" : "demotion",
                rows[i].Tier,
                rows[i].Division,
                rows[i].CapturedAt));
        }

        milestones.Reverse();

        return new RankHistoryResponse(snapshots, milestones);
    }

    /// <summary>
    /// The seasons this account has history in, newest first.
    ///
    /// Drives the picker on the Rank and Champions screens, and its first entry
    /// is what both default to — which is why an account that has not played
    /// since last season keeps showing that one rather than opening on an empty
    /// January.
    ///
    /// An account with no history at all reports the season it is currently in,
    /// so the picker is never empty.
    /// </summary>
    public async Task<IReadOnlyList<SeasonResponse>> PeriodsAsync(
        Guid riotAccountId,
        string puuid,
        CancellationToken cancellationToken = default)
    {
        var seasons = await SeasonsAsync(cancellationToken);
        if (seasons.Count == 0) return [];

        var span = await SpanAsync(riotAccountId, puuid, cancellationToken);

        if (span is null)
        {
            var current = seasons[^1];
            return [Describe(current)];
        }

        return [.. RankedSeasons.Spanning(seasons, span.Value.OldestMs, span.Value.NewestMs).Select(Describe)];
    }

    /// <summary>Every recorded boundary, oldest first — the order everything else assumes.</summary>
    public async Task<IReadOnlyList<Season>> SeasonsAsync(CancellationToken cancellationToken = default)
    {
        var rows = await db.Seasons.AsNoTracking().OrderBy(s => s.StartsAt).ToListAsync(cancellationToken);
        return [.. rows.Select(s => s.ToDomain())];
    }

    public static SeasonResponse Describe(Season season)
    {
        ArgumentNullException.ThrowIfNull(season);
        return new SeasonResponse(season.Id, season.Label, season.StartsAt, season.IsPreseason, season.ResetsRank);
    }

    /// <summary>
    /// The oldest and newest moment this account has any history for.
    ///
    /// Deliberately a span rather than a set of years: a year somebody did not
    /// play still sits between two they did, and a picker with a hole in it reads
    /// as data loss rather than as a quiet year.
    ///
    /// Matches count for every queue, not just the ranked ones, because the
    /// Champions screen uses the same list and carries its own queue filter. The
    /// cost is a year with non-ranked games and no readings offering a button on
    /// the Rank screen that lands on the empty state — filtering to the tracked
    /// queues would fix that and cost Champions the years it legitimately has.
    /// </summary>
    private async Task<(long OldestMs, long NewestMs)?> SpanAsync(
        Guid riotAccountId,
        string puuid,
        CancellationToken cancellationToken)
    {
        var readings = await db.RankSnapshots.AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId)
            .GroupBy(_ => 1)
            .Select(g => new { Min = (long?)g.Min(r => r.CapturedAt), Max = (long?)g.Max(r => r.CapturedAt) })
            .FirstOrDefaultAsync(cancellationToken);

        var games = await db.MatchParticipants.AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => m.GameCreation)
            .GroupBy(_ => 1)
            .Select(g => new { Min = (long?)g.Min(), Max = (long?)g.Max() })
            .FirstOrDefaultAsync(cancellationToken);

        var oldest = Smallest(readings?.Min, games?.Min);
        var newest = Largest(readings?.Max, games?.Max);

        return oldest is null || newest is null ? null : (oldest.Value, newest.Value);
    }

    private static long? Smallest(long? a, long? b) =>
        a is null ? b : b is null ? a : Math.Min(a.Value, b.Value);

    private static long? Largest(long? a, long? b) =>
        a is null ? b : b is null ? a : Math.Max(a.Value, b.Value);
}
