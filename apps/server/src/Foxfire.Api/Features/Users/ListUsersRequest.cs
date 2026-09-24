using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Features.PasswordResets;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.Users;

/// <summary>Somebody on this server, as an admin sees them.</summary>
/// <param name="IsDisabled">Locked out with no end date. They cannot sign in; nothing of theirs is gone.</param>
/// <param name="LinkedRiotAccounts">How many League accounts they have claimed.</param>
/// <param name="ActiveSessions">Live refresh tokens — roughly, machines signed in.</param>
/// <param name="PasswordReset">
/// The reset link outstanding for them, or null. It is here rather than behind
/// a route of its own so that the list can say who is waiting on one, and so
/// that the admin who made a link an hour ago can copy it again without having
/// to make a new one.
/// </param>
public sealed record AdminUserResponse(
    Guid Id,
    string Username,
    string Email,
    bool IsAdmin,
    bool IsDisabled,
    DateTimeOffset CreatedAt,
    int LinkedRiotAccounts,
    int ActiveSessions,
    PasswordResetResponse? PasswordReset);

/// <summary>Everybody on the server, by name.</summary>
public sealed record ListUsersRequest : IDomainRequest<IReadOnlyList<AdminUserResponse>>;

internal sealed class ListUsersRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
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
                db.RefreshTokens.Count(t => t.UserId == u.Id && t.RevokedAt == null && t.ExpiresAt > now),
                null))
            .ToListAsync(cancellationToken);

        // In a second query and mapped in memory, because a link is a signature
        // over the row rather than a column of it — there is nothing for SQL
        // Server to select. There is at most one open reset per account, and
        // making a newer one withdraws the last, so the newest is the one.
        var open = await db.PasswordResets
            .Where(r => r.RedeemedAt == null && r.RevokedAt == null && r.ExpiresAt > now)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(cancellationToken);

        var links = open
            .GroupBy(r => r.UserId)
            .ToDictionary(group => group.Key, group => group.First());

        var described = users
            .Select(user => links.TryGetValue(user.Id, out var reset)
                ? user with { PasswordReset = PasswordResetLookup.Describe(reset, server.Value, auth.Value) }
                : user)
            .ToList();

        return Response<IReadOnlyList<AdminUserResponse>>.Success(described);
    }
}
