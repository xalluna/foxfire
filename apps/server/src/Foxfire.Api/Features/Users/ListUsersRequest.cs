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

/// <summary>
/// The people on the server, by name, a page at a time.
///
/// Searched here rather than in the browser. The list used to arrive whole and
/// be filtered where it was drawn, on the grounds that a community big enough
/// to fill a page of it is a large one — which is exactly the community a whole
/// list stops working for. Name and address both, since an admin looking
/// somebody up has whichever of the two they were given: a Discord handle
/// usually matches the username, a mail forward the address.
/// </summary>
/// <param name="Q">Part of a username or email, any case. Blank is everybody.</param>
public sealed record ListUsersRequest(string? Q = null, int? Limit = null, int? Offset = null)
    : IDomainRequest<Page<AdminUserResponse>>;

internal sealed class ListUsersRequestHandler(
    FoxfireDbContext db,
    IOptions<ServerOptions> server,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<ListUsersRequest, Page<AdminUserResponse>>
{
    public async Task<Response<Page<AdminUserResponse>>> Handle(
        ListUsersRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var now = time.GetUtcNow();
        var needle = (request.Q ?? "").Trim().ToLowerInvariant();

        var adminRoleId = await db.Roles
            .Where(r => r.Name == FoxfireRoles.Admin)
            .Select(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var matching = db.Users.AsQueryable();

        if (needle.Length > 0)
        {
            // Lowered on both sides rather than trusting the column's
            // collation, as the finder does.
            matching = matching.Where(u =>
                (u.UserName ?? "").ToLower().Contains(needle)
                || (u.Email ?? "").ToLower().Contains(needle));
        }

        // The id breaks ties so a page boundary cannot fall between two rows
        // the database would order differently next time. EF counts the filter
        // alone; the three subqueries per row run for the page and no further.
        var users = await matching
            .OrderBy(u => u.UserName)
            .ThenBy(u => u.Id)
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
            .ToPageAsync(PageRequest.Of(request.Limit, request.Offset), cancellationToken);

        // In a second query and mapped in memory, because a link is a signature
        // over the row rather than a column of it — there is nothing for SQL
        // Server to select. There is at most one open reset per account, and
        // making a newer one withdraws the last, so the newest is the one. Only
        // for the people on this page.
        var ids = users.Items.Select(u => u.Id).ToList();

        var open = await db.PasswordResets
            .Where(r => ids.Contains(r.UserId))
            .Where(r => r.RedeemedAt == null && r.RevokedAt == null && r.ExpiresAt > now)
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync(cancellationToken);

        var links = open
            .GroupBy(r => r.UserId)
            .ToDictionary(group => group.Key, group => group.First());

        var described = users.Map(user => links.TryGetValue(user.Id, out var reset)
            ? user with { PasswordReset = PasswordResetLookup.Describe(reset, server.Value, auth.Value) }
            : user);

        return Response<Page<AdminUserResponse>>.Success(described);
    }
}
