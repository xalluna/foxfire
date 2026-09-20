using Foxfire.Api.Common;
using Foxfire.Api.Features.Replays;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// The shared replay library.
///
/// Riot produces one .rofl per game, identical for all ten players — the log is
/// of the game, not of a viewpoint — so one upload serves everybody who was in
/// it. That is the whole feature: a game somebody else played is watchable from
/// inside their own client, with every camera angle, for the cost of one upload
/// nobody had to coordinate.
///
/// No request here carries a replay. The desktop claims a match, gets a signed
/// URL, PUTs the bytes to the store directly, and says it finished; the server
/// then asks the store how big the blob actually is. A 30 MB file through a
/// homelab's API process would be somebody's upstream spent twice and a request
/// held open for the length of an upload, and the verification would be no
/// better — the desktop saying it worked is not evidence either way.
///
/// Claiming is first-come, and a claim expires. Two people finishing the same
/// game both have the file and both will offer it; one wins, the other is told
/// so and does nothing. If the winner's upload never lands, the claim goes
/// stale and the next offer takes it.
/// </summary>
public static class ReplayEndpoints
{
    public static void MapReplayEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/replays").WithTags("Replays").RequireAuthorization();

        group.MapPost("/claim", (
                [FromBody] ClaimReplayRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        group.MapPost("/{matchId}/complete", (
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new CompleteReplayUploadRequest(matchId), cancellationToken));

        group.MapGet("/{matchId}", (
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new DescribeReplayRequest(matchId), cancellationToken));

        group.MapGet("/{matchId}/download", (
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new GrantReplayDownloadRequest(matchId), cancellationToken));

        group.MapDelete("/{matchId}", (
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new DeleteReplayRequest(matchId), cancellationToken));
    }
}
