using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Import;

/// <summary>What the whole import came to, or one page of it.</summary>
/// <param name="Accounts">How many accounts this answer worked LP out for.</param>
/// <param name="Attributed">How many games got an LP figure.</param>
/// <param name="Total">Every account on the server, when asked for a page; null for the whole server at once.</param>
/// <param name="NextOffset">Where the next page starts, or null once the last account is done.</param>
public sealed record ImportSummary(int Accounts, int Attributed, int? Total = null, int? NextOffset = null);

/// <summary>
/// Works out the LP for everything that just arrived.
///
/// Attributed rows are not imported — they are derived from the readings, which
/// are — so this is where a year of somebody's history gets its numbers back.
/// Unbounded rather than the routine thirty days, since the whole point is to
/// reach rows older than any window.
///
/// A page of accounts at a time when asked for one (<paramref name="Offset"/>,
/// <paramref name="Limit"/>), in Id order. The whole server in one request took
/// longer than a client waits on a big community, so the admin was told the
/// import failed when every row had landed. A client from before the paging asks
/// for no page and gets the whole server, as it always did, which is also why a
/// page is opt-in rather than the default here.
/// </summary>
public sealed record FinishImportRequest(int? Offset = null, int? Limit = null) : IDomainRequest<ImportSummary>
{
    /// <summary>Accounts per page, at most. A page has to answer well inside a client's wait.</summary>
    public const int MaximumPage = 25;
}

internal sealed class FinishImportRequestHandler(
    FoxfireDbContext db,
    IServiceScopeFactory scopes,
    IHostApplicationLifetime lifetime,
    IIdentityContext me,
    ILogger<FinishImportRequestHandler> logger)
    : IDomainRequestHandler<FinishImportRequest, ImportSummary>
{
    public async Task<Response<ImportSummary>> Handle(
        FinishImportRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var paged = request.Offset is not null || request.Limit is not null;
        var offset = Math.Max(0, request.Offset ?? 0);
        var limit = Math.Clamp(request.Limit ?? FinishImportRequest.MaximumPage, 1, FinishImportRequest.MaximumPage);

        var everyone = db.RiotAccounts.AsNoTracking().OrderBy(a => a.Id);
        var total = await everyone.CountAsync(cancellationToken);
        var accounts = paged
            ? await everyone.Skip(offset).Take(limit).ToListAsync(cancellationToken)
            : await everyone.ToListAsync(cancellationToken);

        var attributed = 0;

        foreach (var account in accounts)
        {
            // The host's own token rather than the request's: an admin who closes
            // the page, or a client that stops waiting, must not cut an account
            // off part-way. Only the server shutting down does. And a scope per
            // account, so the rows one replay tracks are gone before the next.
            await using var scope = scopes.CreateAsyncScope();
            var attribution = scope.ServiceProvider.GetRequiredService<AttributionRunner>();
            var tftIdentity = scope.ServiceProvider.GetRequiredService<TftIdentity>();
            var stopping = lifetime.ApplicationStopping;

            attributed += await attribution.ReplayAsync(account.Id, account.Puuid, null, stopping);

            // And TFT's, under whichever id TFT is filed by here.
            if (await tftIdentity.KnownPuuidAsync(account, stopping) is { } tftPuuid)
            {
                attributed += await attribution.ReplayAsync(
                    account.Id, Foxfire.Core.Game.Tft, tftPuuid, null, stopping);
            }
        }

        var next = paged && offset + accounts.Count < total ? offset + accounts.Count : (int?)null;

        // One line for the whole import, on its last page. A page knows only
        // its own games, so a paged finish counts accounts.
        if (next is null && paged)
        {
            logger.LogInformation(
                "{Actor}'s import finished: LP worked out for all {Accounts} account(s)", me.Username, total);
        }
        else if (next is null)
        {
            logger.LogInformation(
                "{Actor}'s import finished: {Accounts} account(s), LP worked out for {Attributed} game(s)",
                me.Username,
                accounts.Count,
                attributed);
        }

        return paged
            ? new ImportSummary(accounts.Count, attributed, total, next)
            : new ImportSummary(accounts.Count, attributed);
    }
}
