using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Import;

/// <summary>What the whole import came to.</summary>
public sealed record ImportSummary(int Accounts, int Attributed);

/// <summary>
/// Works out the LP for everything that just arrived.
///
/// Attributed rows are not imported — they are derived from the readings, which
/// are — so this is where a year of somebody's history gets its numbers back.
/// Unbounded rather than the routine thirty days, since the whole point is to
/// reach rows older than any window.
/// </summary>
public sealed record FinishImportRequest : IDomainRequest<ImportSummary>;

internal sealed class FinishImportRequestHandler(
    FoxfireDbContext db,
    AttributionRunner attribution,
    ILogger<FinishImportRequestHandler> logger)
    : IDomainRequestHandler<FinishImportRequest, ImportSummary>
{
    public async Task<Response<ImportSummary>> Handle(
        FinishImportRequest request,
        CancellationToken cancellationToken)
    {
        var accounts = await db.RiotAccounts.AsNoTracking()
            .Select(a => new { a.Id, a.Puuid })
            .ToListAsync(cancellationToken);

        var attributed = 0;

        foreach (var account in accounts)
        {
            attributed += await attribution.ReplayAsync(account.Id, account.Puuid, null, cancellationToken);
        }

        logger.LogInformation(
            "Import finished: {Accounts} account(s), LP worked out for {Attributed} game(s)",
            accounts.Count,
            attributed);

        return new ImportSummary(accounts.Count, attributed);
    }
}
