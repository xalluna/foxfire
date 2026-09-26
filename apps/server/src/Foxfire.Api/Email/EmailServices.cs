using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Email;
using Foxfire.Email.Resend;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Email;

/// <summary>Everything the server's mail is made of, registered in one place.</summary>
public static class EmailServices
{
    /// <summary>
    /// Every provider is registered, keyed by the name Email__Provider gives it,
    /// whether or not it is the one in use — <see cref="ActiveEmailProvider"/>
    /// picks. A provider is built only if something asks for it, so one that is
    /// not configured costs nothing.
    ///
    /// The rest is registered whether or not mail is on. A server with no
    /// provider has an outbox that queues nothing and a dispatcher that never
    /// starts, which is simpler for every feature than asking first.
    /// </summary>
    public static IServiceCollection AddFoxfireEmail(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<EmailOptions>(configuration.GetSection(EmailOptions.Section));

        services.AddHttpClient(ResendEmailProvider.HttpClientName, http =>
        {
            http.Timeout = TimeSpan.FromSeconds(15);

            // Resend refuses a request without one.
            if (!http.DefaultRequestHeaders.UserAgent.TryParseAdd($"Foxfire-Server/{ServerBuild.Version}"))
            {
                http.DefaultRequestHeaders.UserAgent.ParseAdd("Foxfire-Server");
            }
        });

        services.AddSingleton(sp => new ResendEmailProvider(
            sp.GetRequiredService<IHttpClientFactory>(),
            sp.GetRequiredService<IOptions<EmailOptions>>().Value.Resend,
            sp.GetRequiredService<TimeProvider>(),
            sp.GetRequiredService<ILogger<ResendEmailProvider>>()));
        services.AddKeyedSingleton<IEmailProvider>(
            EmailProviders.Resend, (sp, _) => sp.GetRequiredService<ResendEmailProvider>());
        services.AddKeyedSingleton<IEmailWebhookReceiver>(
            EmailProviders.Resend, (sp, _) => sp.GetRequiredService<ResendEmailProvider>());

        services.AddSingleton<ActiveEmailProvider>();
        services.AddSingleton<EmailSignal>();
        services.AddSingleton<EmailState>();
        services.AddScoped<EmailOutbox>();
        services.AddScoped<EmailRenderer>();

        services.AddSingleton<EmailDispatcher>();
        services.AddHostedService(sp => sp.GetRequiredService<EmailDispatcher>());

        return services;
    }
}
