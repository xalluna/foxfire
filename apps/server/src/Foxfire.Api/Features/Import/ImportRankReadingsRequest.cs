using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Import;

/// <summary>One rank reading, keyed by the puuid the source file used.</summary>
public sealed record ImportRankReading(
    string Puuid,
    string QueueType,
    string? Tier,
    string? Division,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    string Source,
    long CapturedAt,
    string? MatchId);

/// <summary>
/// Stores a page of rank readings, mapped onto the accounts they belong to.
///
/// Keyed on the puuid the source file used, which is dead — so this is the
/// batch that most depends on the accounts having gone first. A reading for an
/// id nothing resolved to is skipped rather than guessed at.
/// </summary>
public sealed record ImportRankReadingsRequest(IReadOnlyList<ImportRankReading> Readings)
    : IValidatedRequest<ImportBatchResult>, IImportBatch
{
    public int Count => Readings?.Count ?? 0;
}

internal sealed class ImportRankReadingsRequestValidator : ImportBatchValidator<ImportRankReadingsRequest>;

internal sealed class ImportRankReadingsRequestHandler(FoxfireDbContext db)
    : IValidatedRequestHandler<ImportRankReadingsRequest, ImportBatchResult>
{
    public async Task<Response<ImportBatchResult>> Handle(
        ImportRankReadingsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.Count == 0) return new ImportBatchResult(0, 0, 0);

        var owners = await ImportTranslation.OwnersByPuuidAsync(db, cancellationToken);

        var accepted = 0;
        var skipped = 0;

        foreach (var incoming in request.Readings)
        {
            if (!owners.TryGetValue(incoming.Puuid, out var accountId))
            {
                skipped++;
                continue;
            }

            if (RankedQueues.FromRiotName(incoming.QueueType) is null)
            {
                skipped++;
                continue;
            }

            // One reading per account, queue and instant. An import run twice
            // should not double every point on somebody's graph.
            var already = await db.RankSnapshots.AnyAsync(
                r => r.RiotAccountId == accountId
                    && r.QueueType == incoming.QueueType
                    && r.CapturedAt == incoming.CapturedAt,
                cancellationToken);

            if (already)
            {
                skipped++;
                continue;
            }

            // A tier out of somebody's old stats.db that this server cannot
            // read is stored as unranked, which is what the rest of the import
            // does with anything it cannot place.
            var tier = RankTiers.FromRiotName(incoming.Tier);
            var division = RankDivisions.FromRiotName(incoming.Division);

            db.RankSnapshots.Add(new RankSnapshot
            {
                RiotAccountId = accountId,
                QueueType = incoming.QueueType,
                Tier = tier,
                Division = division,
                LeaguePoints = incoming.LeaguePoints,
                Wins = incoming.Wins,
                Losses = incoming.Losses,

                // Recomputed rather than trusted. The source stored one too, and
                // the ladder maths has moved since some of those rows were
                // written — a stale position would plot a graph nothing else on
                // this server agrees with.
                LadderPosition = Ladder.LadderPosition(new Rank(tier, division, incoming.LeaguePoints)),

                Source = incoming.Source,
                CapturedAt = incoming.CapturedAt,

                // Only a manual reading names a game, and only if that game came
                // across. A dangling id would survive the NO ACTION constraint
                // and then join to nothing.
                MatchId = incoming.Source == RankSources.Manual ? incoming.MatchId : null
            });

            accepted++;
        }

        // A manual reading naming a match that was never imported would fail the
        // foreign key for the whole batch, so those are cleared rather than
        // allowed to take the page down with them.
        await ClearDanglingMatchIdsAsync(db, cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        return new ImportBatchResult(accepted, skipped, 0);
    }

    /// <summary>Drops the match link off any staged reading whose game is not here.</summary>
    private static async Task ClearDanglingMatchIdsAsync(FoxfireDbContext db, CancellationToken cancellationToken)
    {
        var staged = db.ChangeTracker.Entries<RankSnapshot>()
            .Where(e => e.State == EntityState.Added && e.Entity.MatchId is not null)
            .ToList();

        if (staged.Count == 0) return;

        var named = staged.Select(e => e.Entity.MatchId!).Distinct().ToList();

        var present = (await db.Matches.AsNoTracking()
                .Where(m => named.Contains(m.MatchId))
                .Select(m => m.MatchId)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        foreach (var entry in staged.Where(e => !present.Contains(e.Entity.MatchId!)))
        {
            entry.Entity.MatchId = null;
        }
    }
}
