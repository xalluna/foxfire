using Foxfire.Api.Common;
using Foxfire.Api.Features.Recordings;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Recordings on YouTube, one per game per account.
///
/// The address names the account and the game together because a recording is
/// one player's screen. That is what makes "Watch recording" follow whose
/// history is open: Ahri's row asks for Ahri's view of the game, and Riven's
/// row in the same game asks a different address and gets Riven's, or nothing.
///
/// No video passes through here. The desktop uploads straight to YouTube with
/// the person's own Google sign-in, and what arrives is the id it was given,
/// plus the markers that make the video worth watching in Foxfire rather than
/// on youtube.com.
/// </summary>
public static class RecordingEndpoints
{
    public static void MapRecordingEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/riot-accounts/{riotAccountId:guid}/matches/{matchId}/recording")
            .WithTags("Recordings")
            .RequireAuthorization();

        group.MapGet("/", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new GetMatchRecordingRequest(riotAccountId, matchId), cancellationToken));

        group.MapPut("/", (
                Guid riotAccountId,
                string matchId,
                [FromBody] AttachRecordingBody body,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new AttachRecordingRequest(riotAccountId, matchId, body), cancellationToken));

        group.MapDelete("/", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new DetachRecordingRequest(riotAccountId, matchId), cancellationToken));
    }
}
