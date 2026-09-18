using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// Running the LP rule over stored rows and writing what it decides.
///
/// The rule itself is <see cref="RankAttribution"/> in Foxfire.Core, pinned to
/// the same corpus as the desktop's TypeScript original. This is only the part
/// that feeds it and files the answer, which is deliberately all this is: the
/// piece that could be wrong in a way a user would notice has no database in it.
/// </summary>
public sealed class AttributionRunner(FoxfireDbContext db)
{
    /// <summary>
    /// How far back a routine replay reaches.
    ///
    /// A cost control rather than a guarantee. It keeps a sync from walking years
    /// of readings while still covering everything recent enough to still be
    /// arriving — a match published late, a reading taken before its game landed.
    /// What backstops the rest is <see cref="ReplayAsync"/> with no bound, which
    /// the desktop runs once per launch and this runs when a season or a manual
    /// edit changes what the older rows mean.
    /// </summary>
    public static readonly long ReplayWindowMs = 30L * 86_400_000L;

    /// <summary>
    /// Walks every adjacent pair of readings for both ladders and attributes what it can.
    ///
    /// Returns how many rows it wrote. Safe to run as often as you like: an
    /// interval is attributed only when it holds exactly one ranked game, and the
    /// write is an upsert, so a second pass can only ever add information.
    /// </summary>
    /// <param name="sinceMs">
    /// Epoch milliseconds, or null for everything ever recorded.
    /// </param>
    public async Task<int> ReplayAsync(
        Guid riotAccountId,
        string puuid,
        long? sinceMs,
        CancellationToken cancellationToken = default)
    {
        // Loaded once rather than per interval: this walks every stored pair for
        // both ladders, and the list is a handful of rows that cannot change
        // underneath it.
        var seasons = await LoadSeasonsAsync(cancellationToken);
        var candidates = await LoadCandidatesAsync(puuid, sinceMs, cancellationToken);

        var written = 0;

        foreach (var queue in RankedQueues.All)
        {
            var readings = await LoadReadingsAsync(riotAccountId, queue, sinceMs, cancellationToken);
            if (readings.Count < 2) continue;

            foreach (var attribution in RankAttribution.Replay(readings, candidates, seasons))
            {
                if (await UpsertAsync(riotAccountId, attribution, cancellationToken)) written++;
            }
        }

        if (written > 0) await db.SaveChangesAsync(cancellationToken);
        return written;
    }

    /// <summary>
    /// Throws away one ladder's attributions and works them out again from scratch.
    ///
    /// For when an existing row has lost its grounds rather than gained them: a
    /// hand-entered reading deleted, a season boundary corrected. A replay alone
    /// cannot fix those, because it only ever writes what it can still prove and
    /// has no way to retract what it proved last time.
    /// </summary>
    public async Task RebuildAsync(
        Guid riotAccountId,
        string puuid,
        RankedQueue queue,
        CancellationToken cancellationToken = default)
    {
        var queueName = queue.RiotName();

        await db.MatchRanks
            .Where(r => r.RiotAccountId == riotAccountId && r.QueueType == queueName)
            .ExecuteDeleteAsync(cancellationToken);

        // Unbounded, because the rows just deleted reach as far back as the
        // history does and a windowed replay would leave the older ones gone
        // rather than rebuilt.
        await ReplayAsync(riotAccountId, puuid, null, cancellationToken);
    }

    private async Task<IReadOnlyList<Season>> LoadSeasonsAsync(CancellationToken cancellationToken)
    {
        var seasons = await db.Seasons
            .AsNoTracking()
            .OrderBy(s => s.StartsAt)
            .ToListAsync(cancellationToken);

        return [.. seasons.Select(s => s.ToDomain())];
    }

    /// <summary>
    /// The account's own games, as far as the rule cares about them.
    ///
    /// Everything it played in the window, both ladders at once, unfiltered by
    /// queue — <see cref="RankAttribution.Attribute"/> does that filtering
    /// itself, and doing it here as well would mean two places that have to agree
    /// about what counts as a ranked game.
    /// </summary>
    private async Task<IReadOnlyList<RankedMatch>> LoadCandidatesAsync(
        string puuid,
        long? sinceMs,
        CancellationToken cancellationToken)
    {
        var floor = sinceMs ?? long.MinValue;

        var rows = await db.MatchParticipants
            .AsNoTracking()
            .Where(p => p.Puuid == puuid)
            .Join(
                db.Matches.AsNoTracking(),
                p => p.MatchId,
                m => m.MatchId,
                (p, m) => new
                {
                    m.MatchId,
                    m.GameCreation,
                    m.QueueId,
                    p.GameEndedInEarlySurrender
                })
            .Where(x => x.QueueId != null && x.GameCreation >= floor)
            .ToListAsync(cancellationToken);

        return
        [
            .. rows.Select(x => new RankedMatch(
                x.MatchId,
                x.GameCreation,
                x.QueueId!.Value,
                x.GameEndedInEarlySurrender))
        ];
    }

    private async Task<IReadOnlyList<RankReading>> LoadReadingsAsync(
        Guid riotAccountId,
        RankedQueue queue,
        long? sinceMs,
        CancellationToken cancellationToken)
    {
        var queueName = queue.RiotName();
        var floor = sinceMs ?? long.MinValue;

        var rows = await db.RankSnapshots
            .AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId && r.QueueType == queueName && r.CapturedAt >= floor)
            .OrderBy(r => r.CapturedAt)
            .ThenBy(r => r.Id)
            .ToListAsync(cancellationToken);

        return [.. rows.Select(r => r.ToReading())];
    }

    /// <summary>Writes one result, and says whether anything actually changed.</summary>
    private async Task<bool> UpsertAsync(
        Guid riotAccountId,
        MatchRankAttribution attribution,
        CancellationToken cancellationToken)
    {
        var existing = await db.MatchRanks.FirstOrDefaultAsync(
            r => r.MatchId == attribution.MatchId && r.RiotAccountId == riotAccountId,
            cancellationToken);

        if (existing is null)
        {
            db.MatchRanks.Add(new MatchRank
            {
                MatchId = attribution.MatchId,
                RiotAccountId = riotAccountId,
                QueueType = attribution.Queue.RiotName(),
                TierBefore = attribution.TierBefore,
                DivisionBefore = attribution.DivisionBefore,
                LpBefore = attribution.LpBefore,
                TierAfter = attribution.TierAfter,
                DivisionAfter = attribution.DivisionAfter,
                LpAfter = attribution.LpAfter,
                LpDelta = attribution.LpDelta,
                IsPromotion = attribution.IsPromotion,
                IsDemotion = attribution.IsDemotion
            });

            return true;
        }

        existing.QueueType = attribution.Queue.RiotName();
        existing.TierBefore = attribution.TierBefore;
        existing.DivisionBefore = attribution.DivisionBefore;
        existing.LpBefore = attribution.LpBefore;
        existing.TierAfter = attribution.TierAfter;
        existing.DivisionAfter = attribution.DivisionAfter;
        existing.LpAfter = attribution.LpAfter;
        existing.LpDelta = attribution.LpDelta;
        existing.IsPromotion = attribution.IsPromotion;
        existing.IsDemotion = attribution.IsDemotion;

        // An unchanged row is the ordinary outcome of a replay and should not be
        // counted as work done — otherwise every sync reports attributing games
        // it merely re-confirmed.
        return db.Entry(existing).State == EntityState.Modified;
    }
}
