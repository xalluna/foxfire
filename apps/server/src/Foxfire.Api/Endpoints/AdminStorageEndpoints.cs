using Foxfire.Api.Common;
using Foxfire.Api.Features.Storage;
using Foxfire.Data.Entities;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// How much a community has accumulated.
///
/// Worth a page because self-hosting means somebody is paying for the disk,
/// literally or in a NAS they have to think about. The numbers that matter are
/// not symmetrical: SQL Server Express caps at 10 GB and a deduplicated match
/// history takes a long time to reach it, while replays are tens of megabytes
/// each and will be the thing that fills a volume.
///
/// Read-only except for removing a replay, which an admin can already do one at
/// a time through the ordinary route. There is no "delete all matches" here and
/// there should not be: it would be one click between a community and its
/// history, and the failure mode of a blob store filling up is a refused upload
/// rather than a broken server.
/// </summary>
public static class AdminStorageEndpoints
{
    public static void MapAdminStorageEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/storage")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetStorageUsageRequest(), cancellationToken));

        admin.MapGet("/replays", (ISender sender, CancellationToken cancellationToken, int limit = 50) =>
            sender.SendAsync(new ListSharedReplaysRequest(limit), cancellationToken));
    }
}
