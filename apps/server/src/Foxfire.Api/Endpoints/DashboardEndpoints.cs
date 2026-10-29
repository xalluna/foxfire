using Foxfire.Api.Auth;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Reads;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Reading what the server has: history, a game, champion numbers, mastery.
///
/// Every route here is open to any signed-in member, because everything on a
/// Foxfire server is. That is the decision the whole design rests on — match
/// history is shared, so a friend's games are as readable as your own, and the
/// screens that draw them need no idea whose account they are looking at.
///
/// Most are open to outsiders too, on an open server or through a share link
/// for the account they read; see Auth/ReaderAccess.cs. The binding candidates
/// are not — they are for a desktop pairing its own recording with a game.
///
/// Writes are elsewhere. Nothing reachable from this file changes anything.
/// </summary>
public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        var accounts = app.MapGroup("/riot-accounts/{riotAccountId:guid}")
            .WithTags("Reads");

        accounts.MapGet("/dashboard", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new GetDashboardRequest(riotAccountId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        accounts.MapGet("/matches", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    int? limit = null,
                    int? offset = null,
                    int? queueId = null) =>
                sender.SendAsync(new GetMatchesRequest(riotAccountId, limit, offset, queueId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        accounts.MapGet("/matches/{matchId}", (
                    Guid riotAccountId,
                    string matchId,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new GetMatchSummaryRequest(riotAccountId, matchId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        accounts.MapGet("/champions", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    int? queueId = null,
                    string? range = null) =>
                sender.SendAsync(new GetChampionStatsRequest(riotAccountId, queueId, range), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        // An outsider is served what is stored and never sends this to Riot:
        // see GetMasteryRequest.
        accounts.MapGet("/mastery", (
                    Guid riotAccountId,
                    ISender sender,
                    CancellationToken cancellationToken,
                    bool refresh = false,
                    int? queueId = null) =>
                sender.SendAsync(new GetMasteryRequest(riotAccountId, refresh, queueId), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account);

        accounts.MapGet("/bind-candidates", (
                    Guid riotAccountId,
                    long sinceMs,
                    long untilMs,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new GetBindCandidatesRequest(riotAccountId, sinceMs, untilMs), cancellationToken))
            .RequireAuthorization();

        // Not under an account: a match belongs to the server, and the detail
        // screen opens the same row whoever's history reached it. A share link
        // opens it when its account played in it.
        app.MapGet("/matches/{matchId}", (
                    string matchId,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new GetMatchDetailRequest(matchId), cancellationToken))
            .WithTags("Reads")
            .AllowOutsiders(ShareCoverage.LeagueGame);
    }
}
