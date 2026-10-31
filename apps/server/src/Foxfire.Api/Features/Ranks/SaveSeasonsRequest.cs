using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Ranks;

/// <summary>A season boundary, as an admin edits it.</summary>
public sealed record SeasonRequest(int? Id, string Label, long StartsAt, bool IsPreseason, bool ResetsRank);

/// <summary>
/// Replaces one game's whole season list, and then rebuilds everything derived from it.
///
/// One game's, and League's when the request names none. A desktop from before
/// TFT saves its list with no game, and if that replaced the whole table it
/// would delete TFT's sets — or, saved back, file them as League's.
///
/// Whole rather than row-by-row because the boundaries are only meaningful as a
/// series: a season runs until the next one starts, so inserting one changes
/// the end of the one before it. Editing them as a list is also how the
/// desktop's editor already works.
///
/// Admin-only, and that is a stronger gate than it looks. One wrong ResetsRank
/// silently rewrites every member's LP history, because attribution skips reset
/// boundaries and is replayed from scratch — so a mistaken boundary does not
/// fail, it quietly produces different numbers for everybody on the server.
/// </summary>
public sealed record SaveSeasonsRequest(IReadOnlyList<SeasonRequest> Seasons, string? Game = null) : IValidatedRequest;

internal sealed class SaveSeasonsRequestValidator : AbstractValidator<SaveSeasonsRequest>
{
    public SaveSeasonsRequestValidator()
    {
        ClassLevelCascadeMode = CascadeMode.Stop;

        RuleFor(x => x.Game).MustNameAGame();

        RuleFor(x => x.Seasons)
            .Must(seasons => seasons is { Count: > 0 })
            .WithErrorCode("no_seasons")
            .WithMessage("A server needs at least one season, or nothing can tell a ladder reset from a bad night.");

        RuleFor(x => x.Seasons)
            .Must(seasons => seasons.Select(s => s.StartsAt).Distinct().Count() == seasons.Count)
            .WithErrorCode("duplicate_boundary")
            .WithMessage(
                "Two seasons cannot open at the same instant — the ordering is the whole of how a season is read.")
            .When(x => x.Seasons is { Count: > 0 });

        RuleFor(x => x.Seasons)
            .Must(seasons => !seasons.Any(s => string.IsNullOrWhiteSpace(s.Label)))
            .WithErrorCode("unnamed_season")
            .WithMessage("Every season needs a name.")
            .When(x => x.Seasons is { Count: > 0 });
    }
}

internal sealed class SaveSeasonsRequestHandler(
    FoxfireDbContext db,
    IServiceScopeFactory scopes,
    IHostApplicationLifetime lifetime,
    IIdentityContext me,
    ILogger<SaveSeasonsRequestHandler> logger)
    : IValidatedRequestHandler<SaveSeasonsRequest>
{
    public async Task<Response> Handle(SaveSeasonsRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var game = GameParam.Parse(request.Game);

        await db.Seasons.Where(s => s.Game == game).ExecuteDeleteAsync(cancellationToken);

        foreach (var season in request.Seasons.OrderBy(s => s.StartsAt))
        {
            db.Seasons.Add(new RankedSeason
            {
                Label = season.Label.Trim(),
                StartsAt = season.StartsAt,
                IsPreseason = season.IsPreseason,
                ResetsRank = season.ResetsRank,
                Game = game
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        // Every account, both ladders, unbounded. Expensive and rare — this runs
        // when somebody edits a boundary, which happens about once a year.
        //
        // Not optional either: attribution skips reset boundaries and every
        // stored LP figure was computed against the table as it stood, so
        // leaving them alone would mean the graph and the season picker agreed
        // with the new boundaries while the numbers on the match rows still
        // described the old ones.
        var accounts = await db.RiotAccounts.AsNoTracking().ToListAsync(cancellationToken);

        foreach (var account in accounts)
        {
            // A rebuild deletes a ladder's figures and then works them out
            // again, so it runs on the host's token rather than the request's:
            // a client that stops waiting must not leave an account between the
            // two with its LP gone. And a scope per account, so the rows one
            // rebuild tracks are gone before the next begins.
            await using var scope = scopes.CreateAsyncScope();
            var attribution = scope.ServiceProvider.GetRequiredService<AttributionRunner>();
            var stopping = lifetime.ApplicationStopping;

            // TFT's games are filed under the TFT key's id where there is one,
            // and an account never resolved under it has none to rebuild yet.
            var puuid = game == Game.Tft
                ? await scope.ServiceProvider.GetRequiredService<TftIdentity>().KnownPuuidAsync(account, stopping)
                : account.Puuid;
            if (puuid is null) continue;

            foreach (var queue in RankedQueues.Of(game))
            {
                await attribution.RebuildAsync(account.Id, puuid, queue, stopping);
            }
        }

        // A Warning, because it rewrites every member's LP history.
        logger.LogWarning(
            "{Actor} rewrote the {Game} season table ({Count} boundaries); LP was recomputed for {Accounts} account(s)",
            me.Username,
            game.Slug(),
            request.Seasons.Count,
            accounts.Count);

        return Response.Success();
    }
}
