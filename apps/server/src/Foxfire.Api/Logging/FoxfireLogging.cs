using System.Globalization;
using Azure.Storage.Blobs;
using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Telemetry;
using Microsoft.Extensions.Options;
using Serilog;
using Serilog.Debugging;
using Serilog.Events;
using Serilog.Formatting.Compact;
using Serilog.Settings.Configuration;
using Serilog.Templates;

namespace Foxfire.Api.Logging;

/// <summary>
/// Serilog, behind the <c>ILogger&lt;T&gt;</c> every class here already writes to.
///
/// Two destinations by default. The console, because <c>docker logs</c> is the
/// first place a host looks. And the blob store, because the console is gone the
/// moment a container is recreated — which is usually the moment after something
/// went wrong — and the blob store is already there, holding replays.
///
/// Anything else is configuration. Serilog's own <c>Serilog</c> section is read
/// as Serilog documents it: levels, and any of the sinks in
/// <see cref="ReaderOptions"/> under <c>WriteTo</c>. A host sending logs to Seq
/// or an OpenTelemetry collector adds it there, and turns the blob store off
/// with <c>Logs__ToBlob</c> if they no longer want both.
/// </summary>
public static class FoxfireLogging
{
    /// <summary>
    /// The container logs are kept in, beside <c>replays</c>.
    ///
    /// Named rather than configurable, for the reason the replay container is:
    /// a host who wants logs kept apart points <c>ConnectionStrings__Logs</c> at
    /// another account. Replay usage and the replay cap only ever count
    /// <c>replays</c>, so nothing here counts against a community's allowance.
    /// </summary>
    public const string ContainerName = "logs";

    /// <summary>
    /// One blob an hour, in UTC.
    ///
    /// An hour so that pulling the window around an incident is one download
    /// rather than a day's worth to search. The lines are compact JSON, one event
    /// to a line — <c>jq</c> reads it, and so does Seq's importer.
    /// </summary>
    public const string BlobFileName = "{yyyy}/{MM}/{dd}/{HH}.clef";

    private const string ConsoleTemplate =
        "[{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} {Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}";

    /// <summary>
    /// Compact JSON, one event to a line, in the field names Serilog's own
    /// formats use — so Seq's importer and the Compact Log Viewer read it as
    /// they would any other.
    ///
    /// With the message twice: rendered, for a person reading it with jq, and as
    /// its template, for a tool grouping the same message across events. Through
    /// Serilog.Expressions rather than the stock formatter, because the stock one
    /// renders strings into the message with quotes around them.
    /// </summary>
    private const string JsonTemplate =
        "{ {@t, @m, @mt, @l: if @l = 'Information' then undefined() else @l, @x, @tr, @sp, ..@p} }\n";

    /// <summary>
    /// The sinks a host can name in <c>Serilog:WriteTo</c>.
    ///
    /// Listed rather than discovered. Serilog finds sink assemblies by scanning
    /// the dependency manifest, and the release archives are single-file builds,
    /// which have none — so the scan finds nothing and an unknown sink is skipped
    /// without a word. Naming them works in every build. A sink that is not here
    /// is not in the server either; adding one means adding its package too.
    /// </summary>
    public static ConfigurationReaderOptions ReaderOptions() => new(
        typeof(ConsoleLoggerConfigurationExtensions).Assembly,
        typeof(FileLoggerConfigurationExtensions).Assembly,
        typeof(LoggerConfigurationAzureBlobStorageExtensions).Assembly,
        typeof(OpenTelemetryLoggerConfigurationExtensions).Assembly,
        typeof(SeqLoggerConfigurationExtensions).Assembly,
        typeof(LoggerConfigurationApplicationInsightsExtensions).Assembly,
        typeof(CompactJsonFormatter).Assembly,
        typeof(ExpressionTemplate).Assembly);

    public static WebApplicationBuilder AddFoxfireLogging(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        // Serilog reports its own failures here, and nowhere by default. A blob
        // store that stops taking writes would otherwise lose every line after
        // it without a word, and the first anybody would hear of it is reaching
        // for the logs after an incident.
        SelfLog.Enable(Console.Error);

        builder.Services.AddSingleton(services => LogDestinations.From(
            services.GetRequiredService<IConfiguration>(),
            services.GetRequiredService<IOptions<LogOptions>>().Value));

        // The callback form, so the logger is built from the host's configuration
        // rather than from a snapshot taken before it existed — the same rule
        // Startup/Proxies.cs follows. And no bootstrap logger: it can only be
        // handed to one host per process, and the tests build several.
        builder.Services.AddSerilog(
            (services, logger) => Configure(logger, services),
            preserveStaticLogger: true);

        builder.Services.AddHostedService<LogRetention>();

        return builder;
    }

    private static ExpressionTemplate Json() => new(JsonTemplate, CultureInfo.InvariantCulture);

    private static void Configure(LoggerConfiguration logger, IServiceProvider services)
    {
        var options = services.GetRequiredService<IOptions<LogOptions>>().Value;
        var server = services.GetRequiredService<IOptions<ServerOptions>>().Value;
        var destinations = services.GetRequiredService<LogDestinations>();

        logger
            .ReadFrom.Configuration(services.GetRequiredService<IConfiguration>(), ReaderOptions())
            .Enrich.FromLogContext()
            .Enrich.WithProperty("Application", "Foxfire.Server")
            .Enrich.WithProperty("ServerVersion", ServerBuild.Version)
            .Enrich.WithProperty("ServerName", server.Name)
            .Enrich.WithProperty("MachineName", Environment.MachineName);

        if (options.ConsoleFormat == "json")
        {
            logger.WriteTo.Console(Json());
        }
        else
        {
            logger.WriteTo.Console(outputTemplate: ConsoleTemplate, formatProvider: CultureInfo.InvariantCulture);
        }

        // The last few thousand lines, in memory, for the insights page. In code
        // rather than through ReaderOptions: it is not a sink a host chooses,
        // and it is the same singleton the page reads from.
        logger.WriteTo.Sink(services.GetRequiredService<RecentLogs>(), LogEventLevel.Information);

        if (destinations.Blob is { } blob)
        {
            // Every five seconds, in batches. The sink rolls to a -001 blob of
            // its own accord before an hour reaches the append-blob block limit.
            //
            // Its own retainedBlobCountLimit is left off: it lists the whole
            // container after every batch, and counts a rolled blob as though it
            // were another hour. LogRetention does it by age, once a day.
            logger.WriteTo.AzureBlobStorage(
                Json(),
                blob,
                storageContainerName: ContainerName,
                storageFileName: BlobFileName,
                period: TimeSpan.FromSeconds(5),
                batchPostingLimit: 1000,
                useUtcTimeZone: true);
        }
    }
}

/// <summary>
/// Where the logs are going, worked out once and said at boot.
///
/// A blob store that is absent or will not parse turns blob logging off rather
/// than the server, for the reason the replay store does: everything else works
/// without it, and a host is better placed to fix a setting their server tells
/// them about than one that will not start.
/// </summary>
public sealed class LogDestinations
{
    private LogDestinations(BlobServiceClient? blob, string? why)
    {
        Blob = blob;
        WhyNotBlob = why;
    }

    /// <summary>The store the <c>logs</c> container lives in, or null when logs are not kept there.</summary>
    public BlobServiceClient? Blob { get; }

    /// <summary>Why they are not, for the line at boot that says so.</summary>
    public string? WhyNotBlob { get; }

    /// <summary>
    /// <c>ConnectionStrings:Logs</c> when there is one, and otherwise the blob
    /// store replays use — which under docker-compose is Azurite, so logs are
    /// kept with nothing to set.
    /// </summary>
    public static LogDestinations From(IConfiguration configuration, LogOptions options)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(options);

        if (!options.ToBlob) return new(null, "Logs__ToBlob is off");

        var setting = "ConnectionStrings__Logs";
        var connectionString = configuration.GetConnectionString("Logs");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            setting = "ConnectionStrings__Blob";
            connectionString = configuration.GetConnectionString("Blob");
        }

        if (string.IsNullOrWhiteSpace(connectionString)) return new(null, "no blob store is configured");

        try
        {
            return new(new BlobServiceClient(connectionString), null);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            return new(null, $"{setting} could not be parsed");
        }
    }
}
