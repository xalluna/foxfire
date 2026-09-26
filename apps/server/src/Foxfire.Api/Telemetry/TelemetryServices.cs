using System.Diagnostics.Metrics;
using Foxfire.Api.Configuration;
using Foxfire.Riot;

namespace Foxfire.Api.Telemetry;

/// <summary>Everything the insights page is built from, registered in one place.</summary>
public static class TelemetryServices
{
    public static IServiceCollection AddFoxfireTelemetry(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<TelemetryOptions>(configuration.GetSection(TelemetryOptions.Section));

        services.AddSingleton<TelemetryBuffer>();
        services.AddSingleton<ServerMetrics>();
        services.AddSingleton(sp => new RiotMetrics(sp.GetRequiredService<IMeterFactory>()));
        services.AddSingleton<DbCommandTimer>();
        services.AddSingleton<RecentLogs>();
        services.AddSingleton<RecentSyncs>();
        services.AddSingleton<ConnectedClients>();

        // A singleton the readers can ask where the database ends and memory
        // begins, and the hosted service that keeps it moving.
        services.AddSingleton<TelemetryCollector>();
        services.AddHostedService(sp => sp.GetRequiredService<TelemetryCollector>());

        services.AddScoped<InsightsReader>();

        return services;
    }
}
