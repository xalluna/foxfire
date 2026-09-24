using Foxfire.Api.Common;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Claiming a League account, and seeing who has claimed what.
///
/// Reads are open to every member, because everything on this server is: match
/// history is shared, and so is who owns which account. Writes are not — only
/// the owner may release a link, and only an admin may take one away or start
/// tracking somebody nobody here has claimed.
///
/// No read answers with every account. Yours are a list, because that is as
/// many as one person plays on; anybody else's is one lookup by id or Riot ID,
/// or a page of /search. The bare list below is Desktop 0.14's.
/// </summary>
public static class RiotLinkEndpoints
{
    public static void MapRiotLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/riot-accounts").WithTags("Riot accounts").RequireAuthorization();

        // DEPRECATED — every account on the server, for Desktop 0.14 and nobody
        // else. The one place allowed to reach for it; see ListRiotAccountsRequest.
#pragma warning disable CS0618
        group.MapGet("/", (HttpContext http, ISender sender, CancellationToken cancellationToken) =>
        {
            WholeServerAccountList.MarkDeprecated(http.Response);
            return sender.SendAsync(new ListRiotAccountsRequest(), cancellationToken);
        });
#pragma warning restore CS0618

        group.MapGet("/mine", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new ListMyRiotAccountsRequest(), cancellationToken));

        group.MapGet("/lookup", (
                string? gameName,
                string? tagLine,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new FindRiotAccountRequest(gameName, tagLine), cancellationToken));

        group.MapGet("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetRiotAccountRequest(id), cancellationToken));

        group.MapPost("/", (
                [FromBody] LinkRiotAccountRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));

        group.MapDelete("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new UnlinkRiotAccountRequest(id), cancellationToken));

        app.MapPost("/admin/riot-accounts", (
                    [FromBody] AddTrackedAccountRequest request,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(request, cancellationToken))
            .WithTags("Riot accounts")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        app.MapDelete("/admin/riot-accounts/{id:guid}/owner", (
                    Guid id,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new ForceUnlinkRiotAccountRequest(id), cancellationToken))
            .WithTags("Riot accounts")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));
    }
}
