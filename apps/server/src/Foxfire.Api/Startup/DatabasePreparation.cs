using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Startup;

/// <summary>
/// Brings the database up to date and puts the fixed rows in it.
///
/// Migrations are applied automatically on boot rather than being a step a host
/// has to run. That is the right trade here specifically: the install story is
/// "set your secrets and run", the only person who could run a migration by hand
/// is the same person who just started the container, and a server that starts
/// against a schema it does not understand fails in ways that are far harder to
/// explain than a slow first boot.
/// </summary>
public static class DatabasePreparation
{
    public static async Task PrepareDatabaseAsync(
        this IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var log = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("Foxfire.Database");
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();
        if (pending.Count > 0)
        {
            log.LogInformation("Applying {Count} database migration(s): {Migrations}", pending.Count, string.Join(", ", pending));
            await db.Database.MigrateAsync(cancellationToken);
        }

        await SeedRolesAsync(scope.ServiceProvider, log, cancellationToken);
        await PromoteSeededAdminAsync(scope.ServiceProvider, log, cancellationToken);
    }

    private static async Task SeedRolesAsync(IServiceProvider services, ILogger log, CancellationToken cancellationToken)
    {
        var roles = services.GetRequiredService<RoleManager<IdentityRole<Guid>>>();

        foreach (var name in FoxfireRoles.All)
        {
            if (await roles.RoleExistsAsync(name)) continue;

            var created = await roles.CreateAsync(new IdentityRole<Guid>(name) { Id = Guid.CreateVersion7() });
            if (!created.Succeeded)
            {
                throw new InvalidOperationException(
                    $"Could not create the '{name}' role: {string.Join(" ", created.Errors.Select(e => e.Description))}");
            }

            log.LogInformation("Created the {Role} role", name);
        }

        cancellationToken.ThrowIfCancellationRequested();
    }

    /// <summary>
    /// Makes sure the configured admin email is an admin, if it has registered.
    ///
    /// Registration already grants the role, so this is for the cases where that
    /// is not enough: a host changing Admin__Email to hand the server over, or
    /// recovering one where somebody removed the last admin. Either way the
    /// configured address becomes an admin the next time the server starts,
    /// which makes the config file the final say on who owns the server.
    ///
    /// It deliberately does not create the account. A server cannot invent
    /// somebody's password, and one that pre-created an unclaimed admin would be
    /// leaving an account with no password on a machine facing the internet.
    /// </summary>
    private static async Task PromoteSeededAdminAsync(
        IServiceProvider services,
        ILogger log,
        CancellationToken cancellationToken)
    {
        var configured = services.GetRequiredService<IOptions<AdminOptions>>().Value.Email.Trim();
        if (string.IsNullOrWhiteSpace(configured)) return;

        var users = services.GetRequiredService<UserManager<FoxfireUser>>();
        var user = await users.FindByEmailAsync(configured);

        if (user is null)
        {
            log.LogInformation(
                "{Email} is this server's admin and has not registered yet. It becomes an admin as soon as it does.",
                configured);
            return;
        }

        if (await users.IsInRoleAsync(user, FoxfireRoles.Admin)) return;

        await users.AddToRoleAsync(user, FoxfireRoles.Admin);
        log.LogInformation("Promoted {Email} to admin, per Admin__Email", configured);

        cancellationToken.ThrowIfCancellationRequested();
    }
}
