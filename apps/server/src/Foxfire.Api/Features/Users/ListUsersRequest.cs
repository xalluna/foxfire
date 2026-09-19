using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Users;

/// <summary>Somebody on this server, as an admin sees them.</summary>
/// <param name="IsDisabled">Locked out with no end date. They cannot sign in; nothing of theirs is gone.</param>
/// <param name="LinkedRiotAccounts">How many League accounts they have claimed.</param>
/// <param name="ActiveSessions">Live refresh tokens — roughly, machines signed in.</param>
public sealed record AdminUserResponse(
    Guid Id,
    string Username,
    string Email,
    bool IsAdmin,
    bool IsDisabled,
    DateTimeOffset CreatedAt,
    int LinkedRiotAccounts,
    int ActiveSessions);

/// <summary>Everybody on the server, by name.</summary>
public sealed record ListUsersRequest : IDomainRequest<IReadOnlyList<AdminUserResponse>>;

internal sealed class ListUsersRequestHandler(FoxfireDbContext db, TimeProvider time)
    : IDomainRequestHandler<ListUsersRequest, IReadOnlyList<AdminUserResponse>>
{
    public async Task<Response<IReadOnlyList<AdminUserResponse>>> Handle(
        ListUsersRequest request,
        CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();

        var adminRoleId = await db.Roles
            .Where(r => r.Name == FoxfireRoles.Admin)
            .Select(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var users = await db.Users
            .OrderBy(u => u.UserName)
            .Select(u => new AdminUserResponse(
                u.Id,
                u.UserName ?? "",
                u.Email ?? "",
                db.UserRoles.Any(ur => ur.UserId == u.Id && ur.RoleId == adminRoleId),
                u.LockoutEnd != null && u.LockoutEnd > now,
                u.CreatedAt,
                db.RiotAccounts.Count(a => a.OwnerId == u.Id),
                db.RefreshTokens.Count(t => t.UserId == u.Id && t.RevokedAt == null && t.ExpiresAt > now)))
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<AdminUserResponse>>.Success(users);
    }
}
