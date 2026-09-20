using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Users;

/// <summary>
/// The rule that every write in this feature has to respect.
///
/// A server with no administrator cannot be repaired from inside the app. The
/// way back is editing configuration and restarting, and a host who has to
/// discover that has already had a bad evening — so demoting, disabling and
/// deleting all check the same thing, and all say the same sentence.
/// </summary>
internal static class Administrators
{
    /// <summary>Whether this person is the only administrator left.</summary>
    public static async Task<bool> IsLastAsync(FoxfireDbContext db, Guid id, CancellationToken cancellationToken)
    {
        var adminRoleId = await db.Roles
            .Where(r => r.Name == FoxfireRoles.Admin)
            .Select(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (adminRoleId == Guid.Empty) return false;

        var admins = await db.UserRoles
            .Where(ur => ur.RoleId == adminRoleId)
            .Select(ur => ur.UserId)
            .ToListAsync(cancellationToken);

        return admins.Count == 1 && admins[0] == id;
    }

    /// <summary>409, because the request is fine and the state of the server is not.</summary>
    public static Error Last(string verb) =>
        new("last_admin",
            $"That is the only administrator on this server, so there is no way to {verb} them from here. "
            + "Make somebody else an admin first.");

    public const HttpStatusCode LastStatus = HttpStatusCode.Conflict;
}
