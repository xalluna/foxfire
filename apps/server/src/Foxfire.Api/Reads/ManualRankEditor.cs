using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Reads;

/// <summary>
/// A rank somebody typed, as it crosses the wire.
///
/// Riot calls the division "rank" and so does the desktop, while Foxfire.Core
/// calls it a division because a property called Rank beside one called Tier
/// reads as the whole rank. Both names are right where they are, so the
/// translation happens here — at the boundary — rather than by pushing a wire
/// concern into the domain or a domain word onto every screen.
/// </summary>
public sealed record ManualRankDto(string Tier, string? Rank, int LeaguePoints)
{
    /// <summary>
    /// The domain shape, or null when the tier is not one.
    ///
    /// This is where "pick a tier" moved to. ManualRank holds a RankTier and
    /// so cannot be wrong about it, which leaves exactly one way for a typed
    /// rank to be nonsense — the string never became a tier — and this is the
    /// only place that reads that string.
    /// </summary>
    public ManualRank? ToDomain() =>
        RankTiers.FromRiotName(Tier) is { } tier
            ? new ManualRank(tier, RankDivisions.FromRiotName(Rank), LeaguePoints)
            : null;

    public static ManualRankDto? From(ManualRank? rank) =>
        rank is null
            ? null
            : new ManualRankDto(rank.Tier.RiotName(), rank.Division?.RiotName(), rank.LeaguePoints);
}

/// <summary>One hand-entered figure for one game, as the desktop sends it.</summary>
public sealed record ManualRankEditDto(string MatchId, ManualRankDto After, ManualRankDto? Before)
{
    /// <summary>Null when the rank being asserted names a tier that is not one.</summary>
    public ManualRankEdit? ToDomain() =>
        After?.ToDomain() is { } after ? new ManualRankEdit(MatchId, after, Before?.ToDomain()) : null;
}

/// <summary>
/// A ranked game with no worked-out LP, offered for hand-entry.
/// </summary>
/// <param name="Before">The rank going in, so the editor can show it without a second query.</param>
/// <param name="BeforeUsable">
/// Whether that preceding reading can actually anchor an interval. Attribution
/// bails when it has no ladder position, so for the first game the server ever
/// saw — or one following placements — an "after" alone would save and then
/// produce nothing. Those rows collect a "before" too.
/// </param>
public sealed record EditableMatchResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    bool Win,
    int ChampionId,
    string? ChampionName,
    int Kills,
    int Deaths,
    int Assists,
    ManualRankDto? Before,
    long? BeforeAt,
    bool BeforeUsable,
    ManualRankDto? Manual);

/// <summary>
/// Hand-entered LP, for the games attribution cannot work out on its own.
///
/// Everything here writes rank readings and never attributed rows. Readings are
/// what the graph plots and what attribution derives from, so one row written at
/// a game's end time gives the LP figure, the crest, the milestones and the
/// graph at once — and because a replay recomputes the same answer from it every
/// time, an entry needs no protection from being overwritten and no "leave this
/// one alone" flag anywhere.
///
/// Ported from the desktop's manualRankService. The one difference is who may
/// do it: there, the person running the app owns every account in it; here, only
/// the Foxfire account that has claimed the Riot account may type its LP, or a
/// head admin, and the endpoint enforces that before any of this runs.
/// </summary>
/// <summary>A ranked TFT game with no LP figure, as the editor lists it. See @foxfire/core's TftEditableMatch.</summary>
public sealed record TftEditableMatchResponse(
    string MatchId,
    long GameCreation,
    int GameDuration,
    int QueueId,
    int Placement,
    int? TeamPlacement,
    ManualRankDto? Before,
    long? BeforeAt,
    bool BeforeUsable,
    ManualRankDto? Manual);

public sealed class ManualRankEditor(FoxfireDbContext db, AttributionRunner attribution)
{
    /// <summary>
    /// One ranked game as the editor needs it, from whichever game's table:
    /// when it was, and where it is placed among readings — its end for League,
    /// its player's elimination for TFT.
    /// </summary>
    private sealed record EditableGame(string MatchId, long GameCreation, int GameDuration, long PlacedAt);

    /// <summary>
    /// The ranked TFT games on one ladder with no LP figure, or with one typed
    /// in — the same rule and the same "before" reading as League's, from TFT's
    /// boards and placed at the player's elimination.
    /// </summary>
    public async Task<IReadOnlyList<TftEditableMatchResponse>> TftEditableAsync(
        Guid riotAccountId,
        string puuid,
        RankedQueue queue,
        CancellationToken cancellationToken = default)
    {
        var queueType = queue.RiotName();
        var queueId = queue.QueueId();
        var entered = await EnteredAsync(riotAccountId, queueType, cancellationToken);

        var games = await db.TftParticipants.AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => x.m.QueueId == queueId)
            .Where(x =>
                !db.MatchRanks.Any(r => r.MatchId == x.p.MatchId && r.RiotAccountId == riotAccountId)
                || db.RankSnapshots.Any(s =>
                    s.MatchId == x.p.MatchId
                    && s.RiotAccountId == riotAccountId
                    && s.Source == RankSources.Manual))
            .OrderByDescending(x => x.m.GameCreation)
            .Select(x => new
            {
                x.m.MatchId,
                x.m.GameCreation,
                x.m.GameDuration,
                x.p.TimeEliminated,
                x.p.Placement,
                x.p.TeamPlacement
            })
            .ToListAsync(cancellationToken);

        List<TftEditableMatchResponse> result = [];

        foreach (var game in games)
        {
            var placedAt = TftPlacements.GameEnd(game.GameCreation, game.TimeEliminated, game.GameDuration);
            var after = entered.FirstOrDefault(e => e.MatchId == game.MatchId && e.CapturedAt > game.GameCreation);
            var ownBefore = entered.FirstOrDefault(e => e.MatchId == game.MatchId && e.CapturedAt < game.GameCreation);
            var previous = await LastBeforeAsync(riotAccountId, queueType, placedAt, cancellationToken);

            result.Add(new TftEditableMatchResponse(
                game.MatchId,
                game.GameCreation,
                game.GameDuration,
                queueId,
                game.Placement,
                game.TeamPlacement,
                ownBefore?.Rank ?? Describe(previous),
                previous?.CapturedAt,
                previous is not null && previous.LadderPosition is not null,
                after?.Rank));
        }

        return result;
    }

    private sealed record Entered(string MatchId, long CapturedAt, ManualRankDto Rank);

    /// <summary>The hand-entered readings on one ladder, oldest first.</summary>
    private async Task<List<Entered>> EnteredAsync(Guid riotAccountId, string queueType, CancellationToken cancellationToken)
    {
        var manual = await db.RankSnapshots.AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId
                && r.QueueType == queueType
                && r.Source == RankSources.Manual
                && r.MatchId != null
                && r.Tier != null)
            .OrderBy(r => r.CapturedAt)
            .ToListAsync(cancellationToken);

        return
        [
            .. manual
                .Where(r => r.Tier is not null)
                .Select(r => new Entered(
                    r.MatchId!,
                    r.CapturedAt,
                    new ManualRankDto(r.Tier!.Value.RiotName(), r.Division?.RiotName(), r.LeaguePoints ?? 0)))
        ];
    }

    /// <summary>The newest reading before a moment on one ladder, the later row winning a tie.</summary>
    private Task<RankSnapshot?> LastBeforeAsync(
        Guid riotAccountId,
        string queueType,
        long beforeMs,
        CancellationToken cancellationToken) =>
        db.RankSnapshots.AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId && r.QueueType == queueType && r.CapturedAt < beforeMs)
            .OrderByDescending(r => r.CapturedAt)
            .ThenByDescending(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken);

    private static ManualRankDto? Describe(RankSnapshot? reading) =>
        reading?.Tier is { } tier
            ? new ManualRankDto(tier.RiotName(), reading.Division?.RiotName(), reading.LeaguePoints ?? 0)
            : null;

    /// <summary>The ranked games a set of edits names, on one ladder, from that ladder's game.</summary>
    private async Task<Dictionary<string, EditableGame>> GamesAsync(
        string puuid,
        RankedQueue queue,
        IReadOnlyList<string> matchIds,
        CancellationToken cancellationToken)
    {
        var queueId = queue.QueueId();

        if (queue.Game() == Game.Tft)
        {
            var boards = await db.TftParticipants.AsNoTracking()
                .Where(p => p.Puuid == puuid && matchIds.Contains(p.MatchId))
                .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { m, p.TimeEliminated })
                .Where(x => x.m.QueueId == queueId)
                .Select(x => new { x.m.MatchId, x.m.GameCreation, x.m.GameDuration, x.TimeEliminated })
                .ToListAsync(cancellationToken);

            return boards.ToDictionary(
                b => b.MatchId,
                b => new EditableGame(
                    b.MatchId, b.GameCreation, b.GameDuration,
                    TftPlacements.GameEnd(b.GameCreation, b.TimeEliminated, b.GameDuration)));
        }

        var games = await db.MatchParticipants.AsNoTracking()
            .Where(p => p.Puuid == puuid && !p.GameEndedInEarlySurrender && matchIds.Contains(p.MatchId))
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => m)
            .Where(m => m.QueueId == queueId)
            .Select(m => new { m.MatchId, m.GameCreation, m.GameDuration })
            .ToListAsync(cancellationToken);

        return games.ToDictionary(
            g => g.MatchId,
            g => new EditableGame(g.MatchId, g.GameCreation, g.GameDuration, ManualRanks.AfterTime(g.GameCreation, g.GameDuration)));
    }

    /// <summary>
    /// The games the editor can offer, newest first.
    ///
    /// Remakes are left out for the reason attribution ignores them: they move
    /// no LP, so there is nothing to enter. Games attribution worked out on its
    /// own are left out too, since a measured value needs no assertion over it.
    ///
    /// A game somebody has already entered stays in, even though it now has a
    /// figure — it only has one because they supplied it, and dropping it the
    /// moment it was saved would mean a typo could only be fixed by clearing the
    /// entry and starting again.
    /// </summary>
    public async Task<IReadOnlyList<EditableMatchResponse>> EditableAsync(
        Guid riotAccountId,
        string puuid,
        RankedQueue queue,
        CancellationToken cancellationToken = default)
    {
        var queueType = queue.RiotName();
        var queueId = queue.QueueId();

        var manual = await db.RankSnapshots.AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId
                && r.QueueType == queueType
                && r.Source == RankSources.Manual
                && r.MatchId != null
                && r.Tier != null)
            .OrderBy(r => r.CapturedAt)
            .ToListAsync(cancellationToken);

        var entered = manual
            // The SQL above already excludes a null tier. This excludes a
            // stored one that is no longer a tier this server knows — the
            // converter reads it back as null, so the column is not null and
            // the value is.
            .Where(r => r.Tier is not null)
            .Select(r => new
            {
                MatchId = r.MatchId!,
                r.CapturedAt,
                Rank = new ManualRankDto(r.Tier!.Value.RiotName(), r.Division?.RiotName(), r.LeaguePoints ?? 0)
            })
            .ToList();

        var games = await db.MatchParticipants.AsNoTracking()
            .Where(p => p.Puuid == puuid && !p.GameEndedInEarlySurrender)
            .Join(db.Matches.AsNoTracking(), p => p.MatchId, m => m.MatchId, (p, m) => new { p, m })
            .Where(x => x.m.QueueId == queueId)
            .Where(x =>
                !db.MatchRanks.Any(r => r.MatchId == x.p.MatchId && r.RiotAccountId == riotAccountId)
                || db.RankSnapshots.Any(s =>
                    s.MatchId == x.p.MatchId
                    && s.RiotAccountId == riotAccountId
                    && s.Source == RankSources.Manual))
            .OrderByDescending(x => x.m.GameCreation)
            .Select(x => new
            {
                x.m.MatchId,
                x.m.GameCreation,
                x.m.GameDuration,
                x.p.Win,
                x.p.ChampionId,
                x.p.ChampionName,
                Kills = x.p.Kills ?? 0,
                Deaths = x.p.Deaths ?? 0,
                Assists = x.p.Assists ?? 0
            })
            .ToListAsync(cancellationToken);

        List<EditableMatchResponse> result = [];

        foreach (var game in games)
        {
            // A game can carry two entries; the one after its start is the
            // after state and the one before it is the before state.
            var after = entered.FirstOrDefault(e => e.MatchId == game.MatchId && e.CapturedAt > game.GameCreation);
            var ownBefore = entered.FirstOrDefault(e => e.MatchId == game.MatchId && e.CapturedAt < game.GameCreation);

            // The reading attribution will pair this game's entry with: the last
            // one before the game ended. A reading taken while it was being
            // played is the rank it started from, and counting from any earlier
            // one would show a figure that match history never does.
            var end = GameTimes.End(game.GameCreation, game.GameDuration);

            var previous = await db.RankSnapshots.AsNoTracking()
                .Where(r => r.RiotAccountId == riotAccountId
                    && r.QueueType == queueType
                    && r.CapturedAt < end)
                .OrderByDescending(r => r.CapturedAt)
                .ThenByDescending(r => r.Id)
                .FirstOrDefaultAsync(cancellationToken);

            var before = ownBefore?.Rank
                ?? (previous?.Tier is { } previousTier
                    ? new ManualRankDto(
                        previousTier.RiotName(), previous.Division?.RiotName(), previous.LeaguePoints ?? 0)
                    : null);

            result.Add(new EditableMatchResponse(
                game.MatchId,
                game.GameCreation,
                game.GameDuration,
                game.Win,
                game.ChampionId,
                game.ChampionName,
                game.Kills,
                game.Deaths,
                game.Assists,
                before,
                previous?.CapturedAt,
                previous is not null && previous.LadderPosition is not null,
                after?.Rank));
        }

        return result;
    }

    /// <summary>
    /// Stores a batch of entries and rebuilds the ladder's LP in one transaction.
    ///
    /// Batched because entries interact: stating the rank after two games of a
    /// run of three splits it into three single-game intervals, and the third
    /// resolves on its own. Replaying once at the end rather than per row means
    /// the list handed back already reflects that.
    ///
    /// Returns the problem with the request, or null when it was applied.
    /// </summary>
    public async Task<string?> SaveAsync(
        Guid riotAccountId,
        string puuid,
        RankedQueue queue,
        IReadOnlyList<ManualRankEdit> edits,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(edits);

        if (!queue.LpEditable()) return $"{queue.RiotName()} has no LP to type.";

        var queueType = queue.RiotName();
        var matchIds = edits.Select(e => e.MatchId).ToList();
        var games = await GamesAsync(puuid, queue, matchIds, cancellationToken);

        foreach (var edit in edits)
        {
            if (!games.ContainsKey(edit.MatchId))
            {
                return $"{edit.MatchId} is not a ranked game on this ladder awaiting an LP figure.";
            }

            var invalid = ManualRanks.Validate(edit.After);
            if (invalid is not null) return invalid;

            if (edit.Before is not null)
            {
                var invalidBefore = ManualRanks.Validate(edit.Before);
                if (invalidBefore is not null) return invalidBefore;
            }
        }

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);

            foreach (var edit in edits)
            {
                var game = games[edit.MatchId];

                // Replaced rather than added to, so one game cannot accumulate
                // several conflicting assertions at one instant.
                await db.RankSnapshots
                    .Where(r => r.RiotAccountId == riotAccountId
                        && r.MatchId == edit.MatchId
                        && r.Source == RankSources.Manual)
                    .ExecuteDeleteAsync(cancellationToken);

                if (edit.Before is not null)
                {
                    db.RankSnapshots.Add(
                        Reading(riotAccountId, queueType, edit.MatchId, edit.Before,
                            ManualRanks.BeforeTime(game.GameCreation)));
                }

                // Where the game is placed among readings, so the entry closes
                // its own interval: a League game's end, a TFT player's
                // elimination.
                db.RankSnapshots.Add(
                    Reading(riotAccountId, queueType, edit.MatchId, edit.After, game.PlacedAt));
            }

            await db.SaveChangesAsync(cancellationToken);
            await attribution.RebuildAsync(riotAccountId, puuid, queue, cancellationToken);

            await tx.CommitAsync(cancellationToken);
        });

        return null;
    }

    /// <summary>
    /// Drops the entry for one game and rebuilds, reporting whether one existed.
    ///
    /// The rebuild is what makes removing an entry safe. Attribution corrects and
    /// inserts but never deletes, so without it the row the entry produced would
    /// be stranded: the interval would be ambiguous again, nothing would be
    /// written, and the stale hand-entered value would sit there looking measured.
    /// </summary>
    public Task<bool> ClearAsync(
        Guid riotAccountId,
        string puuid,
        string matchId,
        CancellationToken cancellationToken = default) =>
        ClearAsync(riotAccountId, _ => Task.FromResult<string?>(puuid), matchId, cancellationToken);

    /// <summary>
    /// Clears a hand-entered rank on whichever game's ladder it was typed for,
    /// rebuilding that ladder against the account's puuid in that game.
    /// </summary>
    public async Task<bool> ClearAsync(
        Guid riotAccountId,
        Func<Game, Task<string?>> puuidFor,
        string matchId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(puuidFor);

        var queueType = await db.RankSnapshots.AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId
                && r.MatchId == matchId
                && r.Source == RankSources.Manual)
            .Select(r => r.QueueType)
            .FirstOrDefaultAsync(cancellationToken);

        if (queueType is null) return false;

        var queue = RankedQueues.FromRiotName(queueType);
        if (queue is null) return false;

        var puuid = await puuidFor(queue.Value.Game());
        if (puuid is null) return false;

        await db.RankSnapshots
            .Where(r => r.RiotAccountId == riotAccountId
                && r.MatchId == matchId
                && r.Source == RankSources.Manual)
            .ExecuteDeleteAsync(cancellationToken);

        await attribution.RebuildAsync(riotAccountId, puuid, queue.Value, cancellationToken);
        return true;
    }

    private static RankSnapshot Reading(
        Guid riotAccountId,
        string queueType,
        string matchId,
        ManualRank rank,
        long capturedAt) =>
        new()
        {
            RiotAccountId = riotAccountId,
            QueueType = queueType,
            Tier = rank.Tier,
            Division = ManualRanks.StoredDivision(rank),
            LeaguePoints = rank.LeaguePoints,

            // Unknown for an assertion, and nothing reads a reading's win and
            // loss counts.
            Wins = null,
            Losses = null,

            LadderPosition = Ladder.LadderPosition(rank),
            Source = RankSources.Manual,
            CapturedAt = capturedAt,
            MatchId = matchId
        };
}
