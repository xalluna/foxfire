using Foxfire.Api.Common;
using Foxfire.Api.Features.Ranks;
using Foxfire.Api.Reads;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>A batch of hand-entered figures, as the desktop posts one.</summary>
public sealed record SaveManualRanksBody(string QueueType, IReadOnlyList<ManualRankEditDto> Edits);

/// <summary>
/// Rank: the graph, the profile's thirty days of it, the milestones, the periods,
/// and the figures somebody typed.
///
/// Reading is open to every member, like everything else here. Writing splits
/// two ways, and the split is the interesting part.
///
/// Typing LP for a game requires owning the account it was played on, or being
/// a head admin. It is an assertion about what happened to somebody, and the
/// owner is the one in a position to make it; a head admin is who fixes it when
/// they got it wrong, or never came back to it.
///
/// Editing a season is admin-only, because one wrong ResetsRank silently
/// rewrites every member's LP history.
/// </summary>
public static class RankEndpoints
{
    public static void MapRankEndpoints(this IEndpointRouteBuilder app)
    {
        var rank = app.MapGroup("/riot-accounts/{riotAccountId:guid}/rank")
            .WithTags("Rank")
            .RequireAuthorization();

        rank.MapGet("/history", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                string queueType = "RANKED_SOLO_5x5",
                string? range = null) =>
            sender.SendAsync(new GetRankHistoryRequest(riotAccountId, queueType, range), cancellationToken));

        // The profile's graph: the same ladder as /history over thirty days, a
        // close a day. Bounded at 31 points by construction, so not a page.
        rank.MapGet("/trend", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                string queueType = "RANKED_SOLO_5x5") =>
            sender.SendAsync(new GetRankTrendRequest(riotAccountId, queueType), cancellationToken));

        rank.MapGet("/periods", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new GetRankPeriodsRequest(riotAccountId), cancellationToken));

        rank.MapGet("/editable", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                string queueType = "RANKED_SOLO_5x5") =>
            sender.SendAsync(new GetEditableGamesRequest(riotAccountId, queueType), cancellationToken));

        rank.MapPost("/manual", (
                Guid riotAccountId,
                [FromBody] SaveManualRanksBody body,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(
                new SaveManualRanksRequest(riotAccountId, body.QueueType, body.Edits), cancellationToken));

        rank.MapDelete("/manual/{matchId}", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ClearManualRankRequest(riotAccountId, matchId), cancellationToken));

        app.MapGet("/seasons", (ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new ListSeasonsRequest(), cancellationToken))
            .WithTags("Rank")
            .RequireAuthorization();

        app.MapPut("/seasons", (
                    [FromBody] IReadOnlyList<SeasonRequest> seasons,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new SaveSeasonsRequest(seasons), cancellationToken))
            .WithTags("Rank")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));
    }
}
