using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Foxfire.Data;

/// <summary>
/// Lets `dotnet ef migrations add` work without a configured server.
///
/// Without this, EF builds the real application host to find the DbContext —
/// and that host refuses to start unless every secret is set, which is correct
/// at runtime and absurd at a developer's terminal. Adding a migration should
/// not require a Riot API key.
///
/// The connection string here is never connected to. Migrations are generated
/// from the model and the provider's idea of SQL Server's dialect; nothing
/// reaches a database until somebody applies them.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<FoxfireDbContext>
{
    public FoxfireDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<FoxfireDbContext>()
            .UseSqlServer(
                "Server=(design-time);Database=Foxfire;Trusted_Connection=True;",
                sql => sql.MigrationsAssembly(typeof(FoxfireDbContext).Assembly.FullName))
            .Options;

        return new FoxfireDbContext(options);
    }
}
