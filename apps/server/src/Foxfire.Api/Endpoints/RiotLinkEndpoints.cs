using Foxfire.Api.Auth;
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
/// history is shared, and so is who owns which account. They are open to
/// outsiders too where the reader policy says so, though an outsider is never
/// told who claimed what. Writes are not — only the owner may release a link,
/// and only an admin may take one away or start tracking somebody nobody here
/// has claimed.
///
/// No read answers with every account. Yours are a list, because that is as
/// many as one person plays on; anybody else's is one lookup by id or Riot ID,
/// or a page of /search.
/// </summary>
public static class RiotLinkEndpoints
{
    public static void MapRiotLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/riot-accounts").WithTags("Riot accounts");

        // An outsider has nothing of their own, and is told so: an empty list.
        group.MapGet("/mine", (ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new ListMyRiotAccountsRequest(), cancellationToken))
            .AllowOutsiders();

        group.MapGet("/lookup", (
                    string? gameName,
                    string? tagLine,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(new FindRiotAccountRequest(gameName, tagLine), cancellationToken))
            .AllowOutsiders(ShareCoverage.Lookup);

        group.MapGet("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new GetRiotAccountRequest(id), cancellationToken))
            .AllowOutsiders(ShareCoverage.Account with { AccountRouteValue = "id" });

        group.MapPost("/", (
                    [FromBody] LinkRiotAccountRequest request,
                    ISender sender,
                    CancellationToken cancellationToken) =>
                sender.SendAsync(request, cancellationToken))
            .RequireAuthorization();

        group.MapDelete("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
                sender.SendAsync(new UnlinkRiotAccountRequest(id), cancellationToken))
            .RequireAuthorization();

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
