using Foxfire.Api.Auth;
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
///
/// The reads are open to outsiders as League's are (Auth/ReaderAccess.cs): a
/// share link opens an account's TFT along with the rest of its profile.
/// </summary>
public static class TftEndpoints
{
    public static void MapTftEndpoints(this IEndpointRouteBuilder app)
    {
        var tft = app.MapGroup("/riot-accounts/{riotAccountId:guid}/tft")
            .WithTags("TFT");

        tft.MapGet("/dashboard", (Guid riotAccountId, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetTftDashboardRequest(riotAccountId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        tft.MapGet("/matches", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    int? limit = null,
                    int? offset = null,
                    int? queueId = null) =>
                sender.SendAsync(new GetTftMatchesRequest(riotAccountId, limit, offset, queueId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        tft.MapGet("/matches/{matchId}", (
                    Guid riotAccountId,
                    string matchId,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new GetTftMatchSummaryRequest(riotAccountId, matchId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        // The lobby belongs to the game rather than the account, as League's
        // match detail does; it sits here so a TFT id is never asked of
        // League's route. A share link opens it for a game its account played.
        tft.MapGet("/matches/{matchId}/lobby", (string matchId, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetTftLobbyRequest(matchId), cancellationToken))
            .AllowOutsiders(ShareCoverage.TftGame);

        tft.MapGet("/bind-candidates", (
                    Guid riotAccountId,
                    long sinceMs,
                    long untilMs,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new GetTftBindCandidatesRequest(riotAccountId, sinceMs, untilMs), cancellationToken))
            .RequireAuthorization();

        var rank = tft.MapGroup("/rank");

        rank.MapGet("/history", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    string queueType = "RANKED_TFT",
                    string? range = null) =>
                sender.SendAsync(new GetRankHistoryRequest(riotAccountId, queueType, range, Game.Tft), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        rank.MapGet("/trend", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    string queueType = "RANKED_TFT") =>
                sender.SendAsync(new GetRankTrendRequest(riotAccountId, queueType, Game.Tft), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        rank.MapGet("/periods", (Guid riotAccountId, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetRankPeriodsRequest(riotAccountId, Game.Tft), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        rank.MapGet("/editable", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    string queueType = "RANKED_TFT") =>
                sender.SendAsync(new GetTftEditableGamesRequest(riotAccountId, queueType), cancellationToken))
            .RequireAuthorization();

        rank.MapPost("/manual", (
                    Guid riotAccountId,
                    [FromBody] SaveManualRanksBody body,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(
                    new SaveManualRanksRequest(riotAccountId, body.QueueType, body.Edits, Game.Tft), cancellationToken))
            .RequireAuthorization();

        rank.MapDelete("/manual/{matchId}", (
                    Guid riotAccountId,
                    string matchId,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new ClearManualRankRequest(riotAccountId, matchId), cancellationToken))
            .RequireAuthorization();
    }
}
