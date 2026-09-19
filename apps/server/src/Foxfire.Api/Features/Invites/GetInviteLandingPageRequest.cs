using System.Net;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Invites;

/// <summary>
/// The page at the end of the link.
///
/// Deliberately plain and deliberately small. A self-hosted Foxfire server has
/// no web app — this exists only so that a link somebody was emailed leads
/// somewhere that explains itself, rather than to a raw JSON body or a 404. It
/// says what the invite is for and hands over the code to paste into Foxfire.
///
/// The handler renders and the route sets the content type, which is the one
/// place a request answers with something that is not JSON.
/// </summary>
public sealed record GetInviteLandingPageRequest(string Token) : IDomainRequest<string>;

internal sealed class GetInviteLandingPageRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<GetInviteLandingPageRequest, string>
{
    public async Task<Response<string>> Handle(
        GetInviteLandingPageRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (invite, message) = await InviteLookup.ResolveAsync(
            request.Token, db, auth.Value, time, cancellationToken);

        var name = WebUtility.HtmlEncode(server.Value.Name);

        var body = invite is null
            ? $"<p class=\"bad\">{WebUtility.HtmlEncode(message)}</p>"
            : $"""
               <p>You have been invited to join <strong>{name}</strong> on Foxfire as
               <strong>{WebUtility.HtmlEncode(invite.Email)}</strong>.</p>
               <p>Open Foxfire, choose <em>Settings &rarr; Server</em>, connect to
               <code>{WebUtility.HtmlEncode(server.Value.PublicUrl)}</code>, and paste this invite code:</p>
               <pre><code>{WebUtility.HtmlEncode(request.Token)}</code></pre>
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

        return html;
    }
}
