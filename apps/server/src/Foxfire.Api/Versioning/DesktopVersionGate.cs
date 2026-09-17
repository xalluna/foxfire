using Foxfire.Core;

namespace Foxfire.Api.Versioning;

/// <summary>
/// Marks an endpoint as reachable by any desktop, including none at all.
///
/// Only for the handful that have to work before compatibility is known: the
/// version handshake itself, health, and the invite landing page — which is
/// opened in a browser by somebody who may not have Foxfire installed yet.
/// </summary>
public sealed class AllowAnyDesktopVersionAttribute : Attribute;

/// <summary>
/// Turns away desktop builds this server does not speak to.
///
/// "Incompatible version means no service" is the rule, and this is where it is
/// enforced — once, in front of everything, rather than as a check each endpoint
/// could forget. A refused build gets 426 Upgrade Required with the versions
/// that would work, so the desktop can say something specific instead of showing
/// an unexplained failure.
///
/// A build that is on the list but behind gets served normally, with a header
/// saying it is behind. That is the grace window: without it, a host upgrading
/// their server cuts off every friend at once, and with no auto-update on the
/// desktop yet, "cut off" means "until each of them notices and downloads a new
/// installer by hand".
/// </summary>
public sealed class DesktopVersionGate(RequestDelegate next, ILogger<DesktopVersionGate> logger)
{
    /// <summary>What the desktop sends its version as.</summary>
    public const string HeaderName = "X-Foxfire-Client";

    /// <summary>Set on a served response when the caller is behind but still supported.</summary>
    public const string UpgradeAdvisoryHeader = "X-Foxfire-Upgrade-Available";

    public async Task InvokeAsync(HttpContext context, DesktopAllowList allowList)
    {
        if (context.GetEndpoint()?.Metadata.GetMetadata<AllowAnyDesktopVersionAttribute>() is not null)
        {
            await next(context);
            return;
        }

        var claimed = context.Request.Headers[HeaderName].ToString();
        var verdict = allowList.Check(claimed);

        if (verdict.Level == DesktopSupportLevel.Refused)
        {
            logger.LogInformation(
                "Refused a client claiming version '{Claimed}'; this server serves {Minimum} to {Recommended}",
                string.IsNullOrWhiteSpace(claimed) ? "(none)" : claimed,
                verdict.Minimum,
                verdict.Recommended);

            context.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
            await context.Response.WriteAsJsonAsync(new
            {
                error = "unsupported_client",
                message = $"This server needs Foxfire {verdict.Recommended}.",
                apiVersion = DesktopCompatibility.ApiVersion,
                minimumDesktop = verdict.Minimum,
                recommendedDesktop = verdict.Recommended
            });
            return;
        }

        if (verdict.Level == DesktopSupportLevel.Supported)
        {
            context.Response.Headers[UpgradeAdvisoryHeader] = verdict.Recommended;
        }

        await next(context);
    }
}

public static class DesktopVersionGateExtensions
{
    public static IApplicationBuilder UseDesktopVersionGate(this IApplicationBuilder app) =>
        app.UseMiddleware<DesktopVersionGate>();

    /// <summary>Lets this endpoint be called by anything, whatever it claims to be.</summary>
    public static TBuilder AllowAnyDesktopVersion<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.WithMetadata(new AllowAnyDesktopVersionAttribute());
        return builder;
    }
}
