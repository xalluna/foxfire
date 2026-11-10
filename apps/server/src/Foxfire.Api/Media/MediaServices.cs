using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Media;

/// <summary>Recordings on Foxfire Media, registered in one place.</summary>
public static class MediaServices
{
    /// <summary>
    /// Registered whether or not Foxfire Media is configured, as mail is: a
    /// server without it has a client that answers "not set up" and a startup
    /// check that says nothing, and the recording routes are not mapped.
    /// </summary>
    public static IServiceCollection AddFoxfireMedia(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<MediaOptions>(configuration.GetSection(MediaOptions.Section));

        services.AddHttpClient(FoxfireMediaClient.HttpClientName, http =>
        {
            http.Timeout = TimeSpan.FromSeconds(15);
            if (!http.DefaultRequestHeaders.UserAgent.TryParseAdd($"Foxfire-Server/{ServerBuild.Version}"))
            {
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Foxfire-Server");
            }
        });

        services.AddSingleton<FoxfireMediaClient>();
        services.AddHostedService<MediaStartupCheck>();
        return services;
    }
}

/// <summary>
/// Asks Foxfire Media once, at startup, whether it knows this server the way
/// recordings need it to.
///
/// A key it refuses fails every upload, and a missing origin fails every
/// player in the web client — both look, to a member, like a broken video
/// rather than a host's setting. Neither stops the server: Foxfire Media may
/// just be starting too. So it is said, as a warning that names the fix.
/// </summary>
internal sealed class MediaStartupCheck(
    FoxfireMediaClient media,
    IOptions<ServerOptions> server,
    ILogger<MediaStartupCheck> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!media.IsEnabled)
        {
            logger.LogInformation(
                "No Foxfire Media configured, so this server takes no recordings. Set Media__BaseUrl and Media__ApiKey to keep them.");
            return;
        }

        var me = await media.MeAsync(stoppingToken);
        if (me.Outcome == MediaOutcome.KeyRefused)
        {
            logger.LogWarning(
                "Foxfire Media refused this server's key, so no recording can be uploaded or played. "
                + "Media__ApiKey has to be the ApiKeys__<Name> of an application declared on Foxfire Media.");
            return;
        }

        if (!me.IsOk)
        {
            logger.LogWarning("Foxfire Media could not be asked about this server at startup: {Reason}", me.Message);
            return;
        }

        var origin = Uri.TryCreate(server.Value.PublicUrl, UriKind.Absolute, out var url)
            ? url.GetLeftPart(UriPartial.Authority).ToLowerInvariant()
            : null;

        if (origin is not null && !me.Value!.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase))
        {
            logger.LogWarning(
                "Foxfire Media's application {Application} does not list {Origin} in its AllowedOrigins, so the web client "
                + "cannot play recordings. Add it there.",
                me.Value.Name, origin);
        }

        if (me.Value!.WebhookUrl is null)
        {
            logger.LogInformation(
                "Foxfire Media's application {Application} has no WebhookUrl, so recordings are checked on as they are read "
                + "rather than told about. Point it at {Url} for news as it happens.",
                me.Value.Name, $"{server.Value.PublicUrl.TrimEnd('/')}/api/media/webhooks");
        }
        else
        {
            logger.LogInformation("Recordings are kept on Foxfire Media as {Application}", me.Value.Name);
        }
    }
}
