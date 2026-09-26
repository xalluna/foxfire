using Foxfire.Api.Common;
using Foxfire.Api.Features.Email;
using Foxfire.Api.Versioning;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// The server's mail: where the quota stands, what was sent, which addresses
/// it has stopped sending to — and the door the provider comes back in by.
///
/// Head admins only, not every admin. The log is a list of members' addresses,
/// and a suppression is a judgement about somebody's mailbox; both are the
/// kind of thing the head admins of a server are for.
/// </summary>
public static class AdminEmailEndpoints
{
    /// <summary>Webhook bodies are a few hundred bytes. Anything past this is not one.</summary>
    private const int MaxWebhookBytes = 256 * 1024;

    public static void MapAdminEmailEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/email")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.HeadAdmin));

        admin.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetEmailOverviewRequest(), cancellationToken));

        admin.MapGet("/messages", (
                string? kind,
                string? status,
                string? q,
                int? limit,
                int? offset,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ListEmailMessagesRequest(kind, status, q, limit, offset), cancellationToken));

        admin.MapGet("/suppressions", (
                string? q,
                int? limit,
                int? offset,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ListEmailSuppressionsRequest(q, limit, offset), cancellationToken));

        admin.MapDelete("/suppressions/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new ClearEmailSuppressionRequest(id), cancellationToken));

        admin.MapPost("/test", (
                [FromBody] SendTestEmailRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        // The provider, telling the server what became of what it sent. Nobody
        // signs in and no client header comes with it; the signature over the
        // body is the only thing that makes it believed.
        app.MapPost("/email/webhooks/{provider}", async (
                string provider,
                HttpContext http,
                ISender sender,
                CancellationToken cancellationToken) =>
            {
                if (http.Request.ContentLength > MaxWebhookBytes) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

                var body = await ReadBodyAsync(http.Request, cancellationToken);
                if (body is null) return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

                var headers = http.Request.Headers.ToDictionary(
                    h => h.Key,
                    h => h.Value.ToString(),
                    StringComparer.OrdinalIgnoreCase);

                return await sender.SendAsync(new ReceiveEmailWebhookRequest(provider, headers, body), cancellationToken);
            })
            .WithTags("Email")
            .AllowAnyDesktopVersion();
    }

    /// <summary>The raw body, exactly as sent — a signature covers every byte. Null when it runs past the cap.</summary>
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
