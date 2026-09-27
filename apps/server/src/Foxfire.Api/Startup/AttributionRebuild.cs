using System.Diagnostics;
using Foxfire.Api.Services;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Startup;

/// <summary>
/// Works every stored LP figure out again when the rule that decides them changed.
///
/// A replay only ever upserts, and a routine one reaches back thirty days, so
/// neither can take back a row an older rule proved and the current one cannot.
/// Server 0.5.1 was the first time that mattered: games used to be placed by
/// their creation, and a reading taken mid-game handed a game 0 LP, or the
/// previous game's movement. Placing them by their end fixes the rule, and this is
/// what fixes the rows it already wrote.
///
/// Once per rule, on boot, before the server serves — the same doctrine as the
/// migrations beside it. The marker is written only after every account is done,
/// so a server stopped part-way through starts over next time rather than
/// leaving half its figures on the old rule.
/// </summary>
public static class AttributionRebuild
{
    public static async Task RebuildAttributionIfRuleChangedAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Foxfire.Attribution");
        var settings = scope.ServiceProvider.GetRequiredService<ServerSettingsService>();

        var built = await settings.GetAttributionRuleAsync(cancellationToken);
        if (built == RankAttribution.RuleVersion) return;

        var accounts = await scope.ServiceProvider.GetRequiredService<FoxfireDbContext>().RiotAccounts
            .AsNoTracking()
            .Select(a => new { a.Id, a.Puuid })
            .ToListAsync(cancellationToken);

        log.LogInformation(
            "Working out LP again for {Accounts} account(s) under attribution rule {Rule} (was {Previous})",
            accounts.Count,
            RankAttribution.RuleVersion,
            built);

        var timer = Stopwatch.StartNew();
        var written = 0;

        foreach (var account in accounts)
        {
            // A scope per account, so the rows one rebuild tracks are gone before
            // the next begins rather than piling up across the whole server.
            await using var accountScope = services.CreateAsyncScope();
            var attribution = accountScope.ServiceProvider.GetRequiredService<AttributionRunner>();

            written += await attribution.RebuildAllAsync(account.Id, account.Puuid, cancellationToken);
        }

        await settings.SetAttributionRuleAsync(RankAttribution.RuleVersion, cancellationToken);

        log.LogInformation(
            "Worked out {Rows} LP figure(s) for {Accounts} account(s) in {ElapsedMs} ms",
            written,
            accounts.Count,
            timer.ElapsedMilliseconds);
    }
}
