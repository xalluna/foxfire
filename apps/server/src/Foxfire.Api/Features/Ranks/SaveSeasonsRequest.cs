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
/// Replaces the whole season table, and then rebuilds everything derived from it.
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
public sealed record SaveSeasonsRequest(IReadOnlyList<SeasonRequest> Seasons) : IValidatedRequest;

internal sealed class SaveSeasonsRequestValidator : AbstractValidator<SaveSeasonsRequest>
{
    public SaveSeasonsRequestValidator()
    {
        ClassLevelCascadeMode = CascadeMode.Stop;

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
    AttributionRunner attribution,
    ILogger<SaveSeasonsRequestHandler> logger)
    : IValidatedRequestHandler<SaveSeasonsRequest>
{
    public async Task<Response> Handle(SaveSeasonsRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        await db.Seasons.ExecuteDeleteAsync(cancellationToken);

        foreach (var season in request.Seasons.OrderBy(s => s.StartsAt))
        {
            db.Seasons.Add(new RankedSeason
            {
                Label = season.Label.Trim(),
                StartsAt = season.StartsAt,
                IsPreseason = season.IsPreseason,
                ResetsRank = season.ResetsRank
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
        var accounts = await db.RiotAccounts.AsNoTracking()
            .Select(a => new { a.Id, a.Puuid })
            .ToListAsync(cancellationToken);

        foreach (var account in accounts)
        {
            foreach (var queue in RankedQueues.All)
            {
                await attribution.RebuildAsync(account.Id, account.Puuid, queue, cancellationToken);
            }
        }

        logger.LogInformation(
            "An admin rewrote the season table ({Count} boundaries); LP was recomputed for {Accounts} account(s)",
            request.Seasons.Count,
            accounts.Count);

        return Response.Success();
    }
}
