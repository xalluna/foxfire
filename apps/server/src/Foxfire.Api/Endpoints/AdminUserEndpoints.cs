using System.Security.Claims;
using Foxfire.Api.Auth;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

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

/// <summary>Null leaves a field alone.</summary>
public sealed record UpdateUserRequest(bool? IsAdmin, bool? IsDisabled);

/// <summary>
/// Managing who is on the server.
///
/// Three things an admin can do to somebody: make them an admin or stop, stop
/// them signing in or let them again, and remove them. Everything here refuses
/// to leave the server without an administrator, because there is no way back
/// from that through the app — only by editing configuration and restarting,
/// and a host who has to discover that has already had a bad evening.
///
/// Disabling is Identity's lockout with no end date rather than a flag of our
/// own. SignInManager already consults it on every attempt, and a second
/// boolean beside it would be a second answer to the same question.
/// </summary>
public static class AdminUserEndpoints
{
    public static void MapAdminUserEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/admin/users")
            .WithTags("Admin")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        admin.MapGet("/", ListAsync);
        admin.MapPatch("/{id:guid}", UpdateAsync);
        admin.MapDelete("/{id:guid}", DeleteAsync);
    }

    private static async Task<IResult> ListAsync(
        FoxfireDbContext db,
        TimeProvider time,
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

        return Results.Ok(users);
    }

    private static async Task<IResult> UpdateAsync(
        Guid id,
        [FromBody] UpdateUserRequest request,
        ClaimsPrincipal principal,
        UserManager<FoxfireUser> users,
        TokenService tokens,
        FoxfireDbContext db,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(id.ToString());
        if (user is null) return Results.NotFound();

        var wasAdmin = await users.IsInRoleAsync(user, FoxfireRoles.Admin);

        if (request.IsAdmin is false && wasAdmin && await IsLastAdminAsync(db, id, cancellationToken))
        {
            return LastAdmin("demote");
        }

        if (request.IsDisabled is true && wasAdmin && await IsLastAdminAsync(db, id, cancellationToken))
        {
            return LastAdmin("disable");
        }

        if (request.IsAdmin is { } shouldBeAdmin && shouldBeAdmin != wasAdmin)
        {
            if (shouldBeAdmin)
            {
                await users.AddToRoleAsync(user, FoxfireRoles.Admin);
            }
            else
            {
                await users.RemoveFromRoleAsync(user, FoxfireRoles.Admin);
            }

            // Roles live in the access token, which is not revocable and lasts
            // fifteen minutes. Cutting the sessions makes the change take effect
            // now rather than at some point in the next quarter of an hour —
            // which matters a great deal more for a demotion than a promotion.
            await tokens.RevokeAllAsync(id, cancellationToken);

            logger.LogWarning(
                "{Actor} {Action} {Username}",
                principal.FindFirstValue(ClaimTypes.Name),
                shouldBeAdmin ? "promoted" : "demoted",
                user.UserName);
        }

        if (request.IsDisabled is { } shouldBeDisabled)
        {
            await users.SetLockoutEndDateAsync(user, shouldBeDisabled ? DateTimeOffset.MaxValue : null);

            if (shouldBeDisabled)
            {
                // Otherwise they stay signed in on every machine they already
                // were: the lockout only guards signing in again.
                await tokens.RevokeAllAsync(id, cancellationToken);
            }

            logger.LogWarning(
                "{Actor} {Action} {Username}",
                principal.FindFirstValue(ClaimTypes.Name),
                shouldBeDisabled ? "disabled" : "re-enabled",
                user.UserName);
        }

        return Results.NoContent();
    }

    /// <summary>
    /// Removes somebody from the server.
    ///
    /// What goes with them is only theirs: their sessions, and their claim on
    /// any League accounts, which return to unclaimed. What stays is everything
    /// shared — the matches, and the record of which invite let them in, because
    /// a spent invite must not become usable again just because the account it
    /// made is gone.
    ///
    /// That last bit needs doing by hand. The foreign key from an invite to who
    /// redeemed it is NO ACTION at the database level, because SQL Server
    /// refuses two cascading paths between the same pair of tables and the
    /// created-by key already has the one. So the reference is cleared here,
    /// before the delete, or the delete is refused.
    /// </summary>
    private static async Task<IResult> DeleteAsync(
        Guid id,
        UserManager<FoxfireUser> users,
        FoxfireDbContext db,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var user = await users.FindByIdAsync(id.ToString());
        if (user is null) return Results.NotFound();

        if (await IsLastAdminAsync(db, id, cancellationToken)) return LastAdmin("delete");

        await db.Invites
            .Where(i => i.RedeemedByUserId == id)
            .ExecuteUpdateAsync(s => s.SetProperty(i => i.RedeemedByUserId, (Guid?)null), cancellationToken);

        var deleted = await users.DeleteAsync(user);
        if (!deleted.Succeeded)
        {
            return AuthEndpoints.Problem(
                "delete_failed",
                string.Join(" ", deleted.Errors.Select(e => e.Description)));
        }

        logger.LogWarning("Deleted the account {Username}", user.UserName);
        return Results.NoContent();
    }

    /// <summary>Whether this person is the only administrator left.</summary>
    private static async Task<bool> IsLastAdminAsync(
        FoxfireDbContext db,
        Guid id,
        CancellationToken cancellationToken)
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

    private static IResult LastAdmin(string verb) =>
        AuthEndpoints.Problem(
            "last_admin",
            $"That is the only administrator on this server, so there is no way to {verb} them from here. "
            + "Make somebody else an admin first.",
            StatusCodes.Status409Conflict);
}
