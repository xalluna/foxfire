using System.Net;
using System.Security.Claims;
using Foxfire.Api.Configuration;
using Foxfire.Api.Versioning;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Endpoints;

public sealed record CreateInviteRequest(string Email);

/// <summary>An invite as an admin sees it.</summary>
/// <param name="Link">
/// The whole point of the admin-facing shape. SMTP is optional here, so every
/// link the server would have emailed is also readable and copyable — a host
/// with no working mail pastes it into Discord instead.
/// </param>
public sealed record InviteResponse(
    Guid Id,
    string Email,
    string Link,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    DateTimeOffset? RedeemedAt,
    string? RedeemedBy,
    bool IsOpen);

/// <summary>What the landing page and the desktop can learn about a token.</summary>
public sealed record InvitePreviewResponse(bool Usable, string ServerName, string? Email, string Message);

/// <summary>
/// Creating invites, and letting somebody check one.
///
/// The link is clickable as many times as anybody likes; what can only happen
/// once is a registration completing against it. Nothing here spends an invite —
/// that is done by the registration endpoint, inside the transaction that
/// creates the account.
/// </summary>
public static class InviteEndpoints
{
    public static void MapInviteEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/invites")
            .WithTags("Invites")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", ListAsync);
        admin.MapPost("/", CreateAsync);
        admin.MapDelete("/{id:guid}", RevokeAsync);

        // Unauthenticated and version-free: somebody following a link may not
        // have Foxfire installed yet, which is rather the point of an invite.
        app.MapGet("/invites/{token}/preview", PreviewAsync)
            .AllowAnyDesktopVersion()
            .WithTags("Invites");

        app.MapGet("/invite/{token}", LandingAsync)
            .AllowAnyDesktopVersion()
            .ExcludeFromDescription();
    }

    private static async Task<IResult> ListAsync(
        FoxfireDbContext db,
        IOptions<ServerOptions> server,
        IOptions<AuthOptions> auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();

        var invites = await db.Invites
            .Include(i => i.RedeemedBy)
            .OrderByDescending(i => i.CreatedAt)
            .Take(200)
            .ToListAsync(cancellationToken);

        return Results.Ok(invites.Select(i => Describe(i, server.Value, auth.Value, now)));
    }

    private static async Task<IResult> CreateAsync(
        [FromBody] CreateInviteRequest request,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        IOptions<ServerOptions> server,
        IOptions<AuthOptions> auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var email = (request.Email ?? "").Trim();
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@', StringComparison.Ordinal))
        {
            return AuthEndpoints.Problem("invalid_email", "That does not look like an email address.");
        }

        var now = time.GetUtcNow();

        // An outstanding invite for this address is handed back rather than
        // duplicated. An admin who cannot remember whether they already sent one
        // should get the same link again, not a second one that quietly
        // invalidates nothing and confuses both of them.
        var existing = await db.Invites
            .Include(i => i.RedeemedBy)
            .Where(i => i.Email == email && i.RedeemedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
            .OrderByDescending(i => i.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (existing is not null)
        {
            return Results.Ok(Describe(existing, server.Value, auth.Value, now));
        }

        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var createdBy);

        var invite = new Invite
        {
            Id = Guid.CreateVersion7(now),
            Email = email,
            CreatedByUserId = createdBy == Guid.Empty ? null : createdBy,
            CreatedAt = now,
            ExpiresAt = now + auth.Value.InviteLifetime
        };

        db.Invites.Add(invite);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(Describe(invite, server.Value, auth.Value, now));
    }

    /// <summary>
    /// Withdraws an invite that has not been used.
    ///
    /// The row survives, revoked rather than deleted, so that whoever finally
    /// clicks the link is told it was withdrawn instead of being told it never
    /// existed — which is what a forged token gets, and is a different thing.
    /// </summary>
    private static async Task<IResult> RevokeAsync(
        Guid id,
        FoxfireDbContext db,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (invite is null) return Results.NotFound();

        if (invite.RedeemedAt is not null)
        {
            return AuthEndpoints.Problem(
                "invite_already_used",
                "That invite has already been used, so there is nothing to withdraw.");
        }

        invite.RevokedAt ??= time.GetUtcNow();
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    /// <summary>
    /// Says whether a token can still be used, and for which address.
    ///
    /// The email is given back here, unlike anywhere else, and only on a token
    /// that verified against this server's signing key. Somebody holding a valid
    /// invite already knows the address it was sent to — it is theirs — and the
    /// desktop needs it to prefill the form so nobody registers with the wrong
    /// one and is refused for reasons it cannot explain.
    /// </summary>
    private static async Task<IResult> PreviewAsync(
        string token,
        FoxfireDbContext db,
        IOptions<ServerOptions> server,
        IOptions<AuthOptions> auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var (invite, message) = await LookUpAsync(token, db, auth.Value, time, cancellationToken);

        return Results.Ok(new InvitePreviewResponse(
            Usable: invite is not null,
            ServerName: server.Value.Name,
            Email: invite?.Email,
            Message: message));
    }

    /// <summary>
    /// The page at the end of the link.
    ///
    /// Deliberately plain and deliberately small. A self-hosted Foxfire server
    /// has no web app — this exists only so that a link somebody was emailed
    /// leads somewhere that explains itself, rather than to a raw JSON body or a
    /// 404. It says what the invite is for and hands over the code to paste into
    /// Foxfire.
    /// </summary>
    private static async Task<IResult> LandingAsync(
        string token,
        FoxfireDbContext db,
        IOptions<ServerOptions> server,
        IOptions<AuthOptions> auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var (invite, message) = await LookUpAsync(token, db, auth.Value, time, cancellationToken);
        var name = WebUtility.HtmlEncode(server.Value.Name);

        var body = invite is null
            ? $"<p class=\"bad\">{WebUtility.HtmlEncode(message)}</p>"
            : $"""
               <p>You have been invited to join <strong>{name}</strong> on Foxfire as
               <strong>{WebUtility.HtmlEncode(invite.Email)}</strong>.</p>
               <p>Open Foxfire, choose <em>Settings &rarr; Server</em>, connect to
               <code>{WebUtility.HtmlEncode(server.Value.PublicUrl)}</code>, and paste this invite code:</p>
               <pre><code>{WebUtility.HtmlEncode(token)}</code></pre>
               <p class="muted">This code works until {invite.ExpiresAt:D}. You can open this page as many
               times as you like; it will register one account.</p>
               """;

        // $$ so a single brace stays literal CSS and {{ }} is interpolation;
        // the stylesheet below is full of the former.
        var html = $$"""
            <!doctype html>
            <html lang="en"><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1">
            <meta name="robots" content="noindex,nofollow">
            <title>Foxfire invite</title>
            <style>
              :root { color-scheme: light dark; }
              body { font: 16px/1.6 system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; }
              h1 { font-size: 1.4rem; margin-bottom: 1.5rem; }
              pre { background: rgba(127,127,127,.15); padding: .75rem; border-radius: .4rem; overflow-x: auto; }
              code { word-break: break-all; }
              .bad { color: #b3261e; }
              .muted { opacity: .7; font-size: .9rem; }
            </style></head>
            <body><h1>Foxfire &mdash; {{name}}</h1>{{body}}</body></html>
            """;

        return Results.Content(html, "text/html; charset=utf-8");
    }

    /// <summary>
    /// Resolves a token to an invite, or to the reason there isn't one.
    ///
    /// A forged token and an unknown one give the same answer. Only a token that
    /// verified against this server's key is told anything more specific, and
    /// then only about its own state.
    /// </summary>
    private static async Task<(Invite? Invite, string Message)> LookUpAsync(
        string token,
        FoxfireDbContext db,
        AuthOptions auth,
        TimeProvider time,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var verified = InviteToken.Verify(token, auth.InviteSigningKeyBytes, now);

        switch (verified.Status)
        {
            case InviteTokenStatus.Expired:
                return (null, "This invite has expired. Ask whoever sent it for a new one.");
            case InviteTokenStatus.Malformed:
            case InviteTokenStatus.BadSignature:
                return (null, "This invite link is not valid for this server.");
        }

        var invite = await db.Invites.FirstOrDefaultAsync(i => i.Id == verified.InviteId, cancellationToken);

        if (invite is null) return (null, "This invite link is not valid for this server.");
        if (invite.RedeemedAt is not null) return (null, "This invite has already been used.");
        if (invite.RevokedAt is not null) return (null, "This invite was withdrawn.");
        if (invite.ExpiresAt <= now) return (null, "This invite has expired. Ask whoever sent it for a new one.");

        return (invite, "Ready to use.");
    }

    private static InviteResponse Describe(
        Invite invite,
        ServerOptions server,
        AuthOptions auth,
        DateTimeOffset now)
    {
        var token = InviteToken.Issue(invite.Id, invite.ExpiresAt, auth.InviteSigningKeyBytes);

        return new InviteResponse(
            invite.Id,
            invite.Email,
            Link: $"{server.PublicUrl.TrimEnd('/')}/invite/{token}",
            invite.CreatedAt,
            invite.ExpiresAt,
            invite.RedeemedAt,
            invite.RedeemedBy?.UserName,
            invite.IsOpen(now));
    }
}
