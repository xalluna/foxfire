using Foxfire.Api.Common;
using Foxfire.Api.Features.Sync;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Asking the server to go and fetch, and telling it when to.
///
/// The desktop drove its own sync because it was the only thing that existed.
/// Here it signals and the server decides: the League client watcher notices a
/// game ended and posts that fact, and the retry ladder that follows belongs to
/// the server because it has to outlive the laptop closing and must not run
/// twice when two people were in the same game.
///
/// Every write is gated on owning the Riot account. Reads are not, because
/// everything on this server is readable by every member — but a sync spends
/// the community's Riot budget, and a rank reading claims to have seen
/// somebody's client, so neither is a thing to accept from just anybody who is
/// logged in.
/// </summary>
public static class SyncEndpoints
{
    public static void MapSyncEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/sync").WithTags("Sync").RequireAuthorization();

        // The one route that answers with a Location as well as a status, which
        // is an HTTP detail rather than anything the handler has an opinion on.
        group.MapPost("/{riotAccountId:guid}", async (
            Guid riotAccountId,
            ISender sender,
            CancellationToken cancellationToken) =>
        {
            var started = await sender.Send(new StartSyncRequest(riotAccountId), cancellationToken);
            return started.Errors.Count > 0 ? started.ToResult() : Results.Accepted($"/sync/{riotAccountId}");
        });

        group.MapGet("/{riotAccountId:guid}", (
                Guid riotAccountId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new GetSyncStateRequest(riotAccountId), cancellationToken));

        group.MapPost("/game-ended", (
                [FromBody] GameEndedRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        app.MapPost("/rank-readings", (
                [FromBody] RecordRankReadingRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken))
            .WithTags("Sync")
            .RequireAuthorization();
    }
}
