using Foxfire.Api.Common;
using Foxfire.Api.Features.Users;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Managing who is on the server.
///
/// Three things an admin can do to somebody: make them an admin or stop, stop
/// them signing in or let them again, and remove them. Everything here refuses
/// to leave the server without an administrator, because there is no way back
/// from that through the app — only by editing configuration and restarting,
/// and a host who has to discover that has already had a bad evening.
/// </summary>
public static class AdminUserEndpoints
{
    public static void MapAdminUserEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/users")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new ListUsersRequest(), cancellationToken));

        admin.MapPatch("/{id:guid}", (
                Guid id,
                [FromBody] UpdateUserRequest request,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(request with { Id = id }, cancellationToken));

        admin.MapDelete("/{id:guid}", (Guid id, ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new DeleteUserRequest(id), cancellationToken));
    }
}
