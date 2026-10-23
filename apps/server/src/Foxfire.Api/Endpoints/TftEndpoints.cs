using Foxfire.Api.Common;
using Foxfire.Api.Features.Ranks;
using Foxfire.Api.Features.Tft;
using Foxfire.Api.Reads;
using Foxfire.Core;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// One account's TFT, under <c>/riot-accounts/{id}/tft</c>.
///
/// A route of its own for everything that is only ever TFT's — its history,
/// its lobby, its dashboard — so League's routes stay exactly where a desktop
/// from before TFT expects them. Rank is the same machinery as League's, asked
/// about TFT's ladders: the requests take a game, and these pass TFT.
/// </summary>
public static class TftEndpoints
{
    public static void MapTftEndpoints(this IEndpointRouteBuilder app)
    {
        var tft = app.MapGroup("/riot-accounts/{riotAccountId:guid}/tft")
            .WithTags("TFT")
            .RequireAuthorization();

        tft.MapGet("/dashboard", (Guid riotAccountId, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetTftDashboardRequest(riotAccountId), cancellationToken));

        tft.MapGet("/matches", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                int? limit = null,
                int? offset = null,
                int? queueId = null) =>
            sender.SendAsync(new GetTftMatchesRequest(riotAccountId, limit, offset, queueId), cancellationToken));

        tft.MapGet("/matches/{matchId}", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new GetTftMatchSummaryRequest(riotAccountId, matchId), cancellationToken));

        // The lobby belongs to the game rather than the account, as League's
        // match detail does; it sits here so a TFT id is never asked of
        // League's route.
        tft.MapGet("/matches/{matchId}/lobby", (string matchId, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetTftLobbyRequest(matchId), cancellationToken));

        tft.MapGet("/bind-candidates", (
                Guid riotAccountId,
                long sinceMs,
                long untilMs,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new GetTftBindCandidatesRequest(riotAccountId, sinceMs, untilMs), cancellationToken));

        var rank = tft.MapGroup("/rank");

        rank.MapGet("/history", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                string queueType = "RANKED_TFT",
                string? range = null) =>
            sender.SendAsync(new GetRankHistoryRequest(riotAccountId, queueType, range, Game.Tft), cancellationToken));

        rank.MapGet("/trend", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                string queueType = "RANKED_TFT") =>
            sender.SendAsync(new GetRankTrendRequest(riotAccountId, queueType, Game.Tft), cancellationToken));

        rank.MapGet("/periods", (Guid riotAccountId, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetRankPeriodsRequest(riotAccountId, Game.Tft), cancellationToken));

        rank.MapGet("/editable", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken,
                string queueType = "RANKED_TFT") =>
            sender.SendAsync(new GetTftEditableGamesRequest(riotAccountId, queueType), cancellationToken));

        rank.MapPost("/manual", (
                Guid riotAccountId,
                [FromBody] SaveManualRanksBody body,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(
                new SaveManualRanksRequest(riotAccountId, body.QueueType, body.Edits, Game.Tft), cancellationToken));

        rank.MapDelete("/manual/{matchId}", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ClearManualRankRequest(riotAccountId, matchId), cancellationToken));
    }
}
