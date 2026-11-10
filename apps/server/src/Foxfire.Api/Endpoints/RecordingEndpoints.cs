using Foxfire.Api.Common;
using Foxfire.Api.Features.Recordings;
using Foxfire.Api.Media;
using Foxfire.Api.Versioning;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Recordings on Foxfire Media, one per game per account.
///
/// The address names the account and the game together because a recording is
/// one player's screen. That is what makes "Watch recording" follow whose
/// history is open: Ahri's row asks for Ahri's view of the game, and Riven's
/// row in the same game asks a different address and gets Riven's, or nothing.
///
/// No video passes through here. The desktop uploads straight to Foxfire Media
/// with a one-time token this server mints for it, and a client plays straight
/// from Foxfire Media in a page this server mints an address for. What this
/// server keeps is whose view of which game a video is, how far along it is,
/// and the markers that make it worth watching in Foxfire.
///
/// Mapped only on a server with Foxfire Media configured (Program.cs). Without
/// one, the routes fall to the API's JSON 404, which a desktop reads as "this
/// server takes no recordings" — /version says so up front.
/// </summary>
public static class RecordingEndpoints
{
    /// <summary>Foxfire Media's events are a few hundred bytes. Anything near this is not one.</summary>
    private const int MaxWebhookBytes = 64 * 1024;

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

        // Starting an upload, and asking again to carry one on — see the handler.
        group.MapPost("/upload", (
                Guid riotAccountId,
                string matchId,
                [FromBody] StartRecordingUploadBody body,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new StartRecordingUploadRequest(riotAccountId, matchId, body), cancellationToken));

        group.MapPost("/embed", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new CreateRecordingEmbedRequest(riotAccountId, matchId), cancellationToken));

        group.MapDelete("/", (
                Guid riotAccountId,
                string matchId,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new DetachRecordingRequest(riotAccountId, matchId), cancellationToken));

        // Foxfire Media, telling the server what became of a video. Nobody signs
        // in and no client header comes with it; the signature over the body is
        // the only thing that makes it believed.
        app.MapPost("/media/webhooks", async (HttpContext http, ISender sender, CancellationToken cancellationToken) =>
            {
                if (http.Request.ContentLength > MaxWebhookBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

                var body = await ReadBodyAsync(http.Request, cancellationToken);
                if (body is null) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

                var signature = http.Request.Headers[MediaSignature.Header].ToString();
                return await sender.SendAsync(new ReceiveMediaWebhookRequest(signature, body), cancellationToken);
            })
            .WithTags("Recordings")
            .AllowAnyDesktopVersion();
    }

    /// <summary>The raw body, exactly as sent — the signature covers every byte. Null when it runs past the cap.</summary>
    private static async Task<byte[]?> ReadBodyAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];

        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > MaxWebhookBytes) return null;
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }

        return buffer.ToArray();
    }
}
