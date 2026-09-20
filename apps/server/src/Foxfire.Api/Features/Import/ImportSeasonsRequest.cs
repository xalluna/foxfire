using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Import;

/// <summary>One season boundary out of the source file.</summary>
public sealed record ImportSeason(string Label, long StartsAt, bool IsPreseason, bool ResetsRank);

/// <summary>
/// Merges the source's season boundaries into this server's.
///
/// Merged rather than replaced, and matched on the instant a season opened
/// rather than on its name: the boundary is the fact, and two people will have
/// typed "Season 2026" and "2026" for the same one. A server that has been
/// running a while already has boundaries somebody entered, and an import must
/// not overwrite a correction with the copy that predates it.
/// </summary>
public sealed record ImportSeasonsRequest(IReadOnlyList<ImportSeason> Seasons)
    : IDomainRequest<ImportBatchResult>;

internal sealed class ImportSeasonsRequestHandler(FoxfireDbContext db)
    : IDomainRequestHandler<ImportSeasonsRequest, ImportBatchResult>
{
    public async Task<Response<ImportBatchResult>> Handle(
        ImportSeasonsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Uncapped, unlike the other batches: there are a handful of these
        // ever, and the whole point is that they arrive together.
        if (request.Seasons is not { Count: > 0 }) return new ImportBatchResult(0, 0, 0);

        var existing = await db.Seasons.Select(s => s.StartsAt).ToListAsync(cancellationToken);
        var known = existing.ToHashSet();

        var accepted = 0;

        foreach (var incoming in request.Seasons)
        {
            if (!known.Add(incoming.StartsAt)) continue;

            db.Seasons.Add(new RankedSeason
            {
                Label = incoming.Label,
                StartsAt = incoming.StartsAt,
                IsPreseason = incoming.IsPreseason,
                ResetsRank = incoming.ResetsRank
            });

            accepted++;
        }

        await db.SaveChangesAsync(cancellationToken);

        return new ImportBatchResult(accepted, request.Seasons.Count - accepted, 0);
    }
}
