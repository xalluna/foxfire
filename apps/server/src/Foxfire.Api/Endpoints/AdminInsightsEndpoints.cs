using Foxfire.Api.Common;
using Foxfire.Api.Features.Insights;
using Foxfire.Data.Entities;
using MediatR;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// What the server is doing and has been doing, for whoever runs it.
///
/// One route per tab rather than one with a section in it, so that a desktop
/// asking a server too old to have any of them gets the JSON 404 it reads as
/// "update the server" — rather than a 400 for a section it mistyped, which it
/// would read the same way.
///
/// Left out of the request measurements themselves. An open insights page asks
/// every few seconds, and a chart of requests that is mostly its own polling
/// says nothing about anybody else.
/// </summary>
public static class AdminInsightsEndpoints
{
    public static void MapAdminInsightsEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/insights")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin))
            .DisableHttpMetrics();

        admin.MapGet("/overview", (string? window, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetInsightsOverviewRequest(window), cancellationToken));

        admin.MapGet("/requests", (string? window, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetInsightsRequestsRequest(window), cancellationToken));

        admin.MapGet("/riot", (string? window, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetInsightsRiotRequest(window), cancellationToken));

        admin.MapGet("/sync", (string? window, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetInsightsSyncRequest(window), cancellationToken));

        admin.MapGet("/runtime", (string? window, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetInsightsRuntimeRequest(window), cancellationToken));

        admin.MapGet("/logs", (
                string? level,
                int? limit,
                int? offset,
                long? before,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ListServerLogsRequest(level, limit, offset, before), cancellationToken));
    }
}
