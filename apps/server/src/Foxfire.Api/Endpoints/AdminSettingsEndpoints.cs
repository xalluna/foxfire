using Foxfire.Api.Common;
using Foxfire.Api.Features.ServerSettings;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// The switches behind the server management section of the desktop's settings.
///
/// Deliberately short, and deliberately not where secrets live. The Riot API
/// key, the connection strings and the signing keys are environment
/// configuration — changing one is an edit and a restart, not a button. What is
/// here is what can safely change underneath a running server.
///
/// The file is a route table and nothing else. Which routes exist, what they
/// are called, and who is allowed to reach them live here; what they do lives
/// in Features/ServerSettings, one request to a file. Authorization stays on
/// the route rather than moving into a handler, because a policy is a fact
/// about an endpoint and minimal APIs already know how to enforce one.
/// </summary>
public static class AdminSettingsEndpoints
{
    public static void MapAdminSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/settings")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new GetServerSettingsRequest(), cancellationToken));

        admin.MapPatch("/", (
                [FromBody] UpdateServerSettingsRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request, cancellationToken));
    }
}
