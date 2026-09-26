using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Users;

/// <summary>
/// The rules that every write in this feature has to respect.
///
/// A server with no administrator cannot be repaired from inside the app. The
/// way back is editing configuration and restarting, and a host who has to
/// discover that has already had a bad evening — so demoting, disabling and
/// deleting all check the same thing, and all say the same sentence. The same
/// goes for the last head admin.
///
/// Admins answer to head admins, not to each other. Any admin may let somebody
/// in — promote a member, enable an account — but only a head admin may act
/// against another admin: demote, disable, remove, or make a reset link, which
/// hands the account to whoever holds it. Otherwise a head admin would be one
/// plain admin's reset link away from being somebody else. Yourself is the
/// exception; stepping down is anybody's to do.
///
/// And the account in Admin__Email answers to nobody here. It is re-granted
/// head admin on every boot and its address is pinned, so the configuration is
/// already the final say on who owns the server; demoting it from inside the
/// app would only last until the next restart, and disabling or removing it
/// would outlast it.
/// </summary>
internal static class Administrators
{
    /// <summary>Whether this person is the only holder of a role.</summary>
    public static async Task<bool> IsLastAsync(
        FoxfireDbContext db,
        Guid id,
        string role,
        CancellationToken cancellationToken)
    {
        var roleId = await db.Roles
            .Where(r => r.Name == role)
            .Select(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (roleId == Guid.Empty) return false;

        var holders = await db.UserRoles
            .Where(ur => ur.RoleId == roleId)
            .Select(ur => ur.UserId)
            .ToListAsync(cancellationToken);

        return holders.Count == 1 && holders[0] == id;
    }

    /// <summary>The last-admin or last-head-admin refusal, whichever applies first, or null.</summary>
    public static async Task<Error?> LastHolderAsync(
        FoxfireDbContext db,
        Guid id,
        string verb,
        bool losesAdmin,
        bool losesHeadAdmin,
        CancellationToken cancellationToken)
    {
        if (losesAdmin && await IsLastAsync(db, id, FoxfireRoles.Admin, cancellationToken)) return Last(verb);

        if (losesHeadAdmin && await IsLastAsync(db, id, FoxfireRoles.HeadAdmin, cancellationToken))
        {
            return LastHead(verb);
        }

        return null;
    }

    /// <summary>409, because the request is fine and the state of the server is not.</summary>
    public static Error Last(string verb) =>
        new("last_admin",
            $"That is the only administrator on this server, so there is no way to {verb} them from here. "
            + "Make somebody else an admin first.");

    public static Error LastHead(string verb) =>
        new("last_head_admin",
            $"That is the only head admin on this server, so there is no way to {verb} them from here. "
            + "Make somebody else a head admin first.");

    public const HttpStatusCode LastStatus = HttpStatusCode.Conflict;

    /// <summary>403: the caller is an admin, and this is a head admin's to do.</summary>
    public static Error HeadAdminOnly(string what) =>
        new("head_admin_only", $"Only a head admin can {what}.");

    public const HttpStatusCode HeadAdminOnlyStatus = HttpStatusCode.Forbidden;

    /// <summary>409, like the last admin: it is the server's configuration that says no, not the caller.</summary>
    public static Error Configured(string username, string verb) =>
        new("configured_admin",
            $"{username} is the head admin this server's configuration names, so they cannot be {verb} "
            + "from here. Change Admin__Email and restart the server to hand it to somebody else.");

    public const HttpStatusCode ConfiguredStatus = HttpStatusCode.Conflict;
}
