using System.Text.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Reads;

/// <summary>What a TFT game was worth on its ladder: League's figure, with Hyper Roll's colours.</summary>
public sealed record TftMatchRankSummary(
    int LpDelta,
    string? TierBefore,
    string? RankBefore,
    string? TierAfter,
    string? RankAfter,
    bool IsPromotion,
    bool IsDemotion,
    string? RatedTierBefore,
    string? RatedTierAfter);

/// <summary>One player's board in one TFT game, as a history row draws it. See @foxfire/core's TftMatchSummary.</summary>
public sealed record TftMatchSummaryResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    int? QueueId,
    int? SetNumber,
    int Placement,
    int? TeamPlacement,
    int Level,
    int LastRound,
    double TimeEliminated,
    int PlayersEliminated,
    int TotalDamageToPlayers,
    int GoldLeft,
    IReadOnlyList<TftTraitRow> Traits,
    IReadOnlyList<TftUnitRow> Units,
    IReadOnlyList<string> Augments,
    TftMatchRankSummary? Rank,
    bool HasManualRank,
    MatchRecordingSummary? Recording);

/// <summary>One of the eight boards in a lobby.</summary>
public sealed record TftLobbyParticipantResponse(
    string Puuid,
    string? GameName,
    string? TagLine,
    Guid? AccountId,
    int Placement,
    int? TeamPlacement,
    int? PartnerGroupId,
    int Level,
    int LastRound,
    double TimeEliminated,
    int PlayersEliminated,
    int TotalDamageToPlayers,
    int GoldLeft,
    IReadOnlyList<TftTraitRow> Traits,
    IReadOnlyList<TftUnitRow> Units,
    IReadOnlyList<string> Augments);

/// <summary>Everybody's board in one game, best placement first.</summary>
public sealed record TftLobbyResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    int? QueueId,
    int? SetNumber,
    IReadOnlyList<TftLobbyParticipantResponse> Participants);

/// <summary>How one ladder's games have finished this set.</summary>
/// <param name="Placements">Games per place, first place first: eight, or four teams in Double Up.</param>
/// <param name="TopRate">The share of games in the top half — four, or two teams. Null with no games.</param>
public sealed record TftLadderSummaryResponse(
    string QueueType,
    int Games,
    IReadOnlyList<int> Placements,
    double? AveragePlacement,
    double? TopRate);

/// <summary>A TFT game a recording might be of.</summary>
/// <param name="TimeEliminated">Seconds into the game this player was out, which is when their recording stopped.</param>
public sealed record TftBindCandidateResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    int? QueueId,
    double TimeEliminated);

/// <summary>
/// Everything the TFT screens read.
///
/// The TFT counterpart of <see cref="MatchReads"/>: every read starts from the
/// account's boards by its TFT puuid and reaches the game by key, so League's
/// games, which have no boards, are invisible here as TFT's are there.
/// </summary>
public sealed class TftReads(FoxfireDbContext db, TftIdentity identity, RankReads ranks, TimeProvider time)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>The account's TFT puuid as already known, or null when it has no TFT history here.</summary>
    public Task<string?> PuuidAsync(Data.Entities.RiotAccount account, CancellationToken cancellationToken = default) =>
        identity.KnownPuuidAsync(account, cancellationToken);

    /// <summary>How many TFT games one player has under a queue filter — the total beside a page.</summary>
    public Task<int> MatchCountAsync(string puuid, int? queueId, CancellationToken cancellationToken = default) =>
        db.TftParticipants
            .AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => m)
            .Where(m => queueId == null || m.QueueId == queueId)
            .CountAsync(cancellationToken);

    /// <summary>
    /// A page of TFT history for one player, newest first and ending on the id,
    /// with the LP, the hand-entered flag and the recording each row carries.
    ///
    /// The recording is keyed on the account whose history this is, as League's
    /// is — a recording is one player's view of one game.
    /// </summary>
    public async Task<IReadOnlyList<TftMatchSummaryResponse>> MatchListAsync(
        string puuid,
        Guid? riotAccountId,
        int limit,
        int offset,
        int? queueId,
        string? matchId = null,
        CancellationToken cancellationToken = default)
    {
        var rows = await db.TftParticipants
            .AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => queueId == null || x.m.QueueId == queueId)
            .Where(x => matchId == null || x.m.MatchId == matchId)
            .OrderByDescending(x => x.m.GameCreation)
            .ThenByDescending(x => x.m.MatchId)
            .Skip(offset)
            .Take(limit)
            .Select(x => new
            {
                x.m,
                x.p,
                Rank = db.MatchRanks
                    .Where(r => r.MatchId == x.p.MatchId && r.RiotAccountId == riotAccountId)
                    .Select(r => new
                    {
                        r.LpDelta, r.TierBefore, r.DivisionBefore, r.TierAfter, r.DivisionAfter,
                        r.IsPromotion, r.IsDemotion, r.RatedTierBefore, r.RatedTierAfter
                    })
                    .FirstOrDefault(),
                HasManualRank = db.RankSnapshots.Any(s =>
                    s.MatchId == x.p.MatchId
                    && s.Source == "manual"
                    && s.RiotAccountId == riotAccountId),
#if FEATURE_YOUTUBE
                Recording = db.MatchRecordings
                    .Where(r => r.MatchId == x.p.MatchId && r.RiotAccountId == riotAccountId)
                    .Select(r => new MatchRecordingSummary(r.YouTubeVideoId, r.Privacy, r.EventsJson != null))
                    .FirstOrDefault()
#else
                Recording = (MatchRecordingSummary?)null
#endif
            })
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(x => new TftMatchSummaryResponse(
                x.m.MatchId,
                x.m.GameCreation,
                x.m.GameDuration,
                x.m.QueueId,
                x.m.TftSetNumber,
                x.p.Placement,
                x.p.TeamPlacement,
                x.p.Level,
                x.p.LastRound,
                x.p.TimeEliminated,
                x.p.PlayersEliminated,
                x.p.TotalDamageToPlayers,
                x.p.GoldLeft,
                Traits(x.p.TraitsJson),
                Units(x.p.UnitsJson),
                Augments(x.p.AugmentsJson),
                x.Rank is null
                    ? null
                    : new TftMatchRankSummary(
                        x.Rank.LpDelta,
                        x.Rank.TierBefore?.RiotName(),
                        x.Rank.DivisionBefore?.RiotName(),
                        x.Rank.TierAfter?.RiotName(),
                        x.Rank.DivisionAfter?.RiotName(),
                        x.Rank.IsPromotion,
                        x.Rank.IsDemotion,
                        x.Rank.RatedTierBefore?.RiotName(),
                        x.Rank.RatedTierAfter?.RiotName()),
                x.HasManualRank,
                x.Recording))
        ];
    }

    /// <summary>
    /// Everybody's board in one TFT game, best placement first, each named by
    /// the account this server tracks for them where it tracks one. Null when
    /// the game is not a TFT game here.
    /// </summary>
    public async Task<TftLobbyResponse?> LobbyAsync(string matchId, CancellationToken cancellationToken = default)
    {
        var match = await db.Matches.AsNoTracking()
            .FirstOrDefaultAsync(m => m.MatchId == matchId && m.Game == Game.Tft, cancellationToken);

        if (match is null) return null;

        var boards = await db.TftParticipants.AsNoTracking()
            .Where(p => p.MatchId == matchId)
            .OrderBy(p => p.Placement)
            .ThenBy(p => p.Puuid)
            .ToListAsync(cancellationToken);

        var accounts = await identity.AccountsByPuuidAsync([.. boards.Select(b => b.Puuid)], cancellationToken);

        return new TftLobbyResponse(
            match.MatchId,
            match.GameCreation,
            match.GameDuration,
            match.QueueId,
            match.TftSetNumber,
            [
                .. boards.Select(b => new TftLobbyParticipantResponse(
                    b.Puuid,
                    b.GameName,
                    b.TagLine,
                    accounts.TryGetValue(b.Puuid, out var id) ? id : null,
                    b.Placement,
                    b.TeamPlacement,
                    b.PartnerGroupId,
                    b.Level,
                    b.LastRound,
                    b.TimeEliminated,
                    b.PlayersEliminated,
                    b.TotalDamageToPlayers,
                    b.GoldLeft,
                    Traits(b.TraitsJson),
                    Units(b.UnitsJson),
                    Augments(b.AugmentsJson)))
            ]);
    }

    /// <summary>
    /// How each TFT ladder's games have finished in the current TFT season.
    ///
    /// One grouped read over the season's bounds — never the page of history a
    /// screen has loaded, which is what makes "149 games, 4.46 on average"
    /// mean the season rather than the last twenty. Double Up counts the team's
    /// place, four of them. With no TFT seasons entered it counts everything.
    /// </summary>
    public async Task<(IReadOnlyList<TftLadderSummaryResponse> Ladders, string? SeasonLabel)> LaddersAsync(
        string? puuid,
        CancellationToken cancellationToken = default)
    {
        var seasons = await ranks.SeasonsAsync(Game.Tft, cancellationToken);
        var current = RankedSeasons.SeasonAt(seasons, time.GetUtcNow().ToUnixTimeMilliseconds());
        var bounds = current is null ? null : RankedSeasons.BoundsOf(seasons, current.Id);
        var from = bounds?.StartMs;
        var until = bounds?.EndMs;

        var ladders = RankedQueues.Of(Game.Tft);
        var queueIds = ladders.Select(q => q.QueueId()).ToList();

        var finishes = puuid is null
            ? []
            : await db.TftParticipants.AsNoTracking()
                .Where(p => p.Puuid == puuid)
                .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p.Placement, p.TeamPlacement, m.QueueId, m.GameCreation })
                .Where(x => x.QueueId != null && queueIds.Contains(x.QueueId.Value))
                .Where(x => from == null || x.GameCreation >= from)
                .Where(x => until == null || x.GameCreation < until)
                .Select(x => new { x.Placement, x.TeamPlacement, x.QueueId })
                .ToListAsync(cancellationToken);

        List<TftLadderSummaryResponse> summaries = [];

        foreach (var ladder in ladders)
        {
            var slots = ladder.PlacementSlots();
            var counted = finishes
                .Where(f => f.QueueId == ladder.QueueId())
                .Select(f => TftPlacements.Counted(f.Placement, f.TeamPlacement, f.QueueId))
                .Where(place => place >= 1 && place <= slots)
                .ToList();

            var placements = Enumerable.Range(1, slots).Select(place => counted.Count(c => c == place)).ToList();

            summaries.Add(new TftLadderSummaryResponse(
                ladder.RiotName(),
                counted.Count,
                placements,
                counted.Count == 0 ? null : counted.Average(),
                counted.Count == 0 ? null : counted.Count(c => c <= slots / 2) / (double)counted.Count));
        }

        return (summaries, current?.Label);
    }

    /// <summary>The TFT games a recording made in a window might be of — bounded, like League's.</summary>
    public async Task<IReadOnlyList<TftBindCandidateResponse>> BindCandidatesAsync(
        string puuid,
        long sinceMs,
        long untilMs,
        CancellationToken cancellationToken = default) =>
        await db.TftParticipants.AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => x.m.GameCreation >= sinceMs && x.m.GameCreation <= untilMs)
            .OrderByDescending(x => x.m.GameCreation)
            .Select(x => new TftBindCandidateResponse(
                x.m.MatchId, x.m.GameCreation, x.m.GameDuration, x.m.QueueId, x.p.TimeEliminated))
            .ToListAsync(cancellationToken);

    private static IReadOnlyList<TftTraitRow> Traits(string json) =>
        JsonSerializer.Deserialize<List<TftTraitRow>>(json, Json) ?? [];

    private static IReadOnlyList<TftUnitRow> Units(string json) =>
        JsonSerializer.Deserialize<List<TftUnitRow>>(json, Json) ?? [];

    private static IReadOnlyList<string> Augments(string? json) =>
        json is null ? [] : JsonSerializer.Deserialize<List<string>>(json, Json) ?? [];
}
