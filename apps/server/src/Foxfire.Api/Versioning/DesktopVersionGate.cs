using Foxfire.Api.Common;
using Foxfire.Core;

namespace Foxfire.Api.Versioning;

/// <summary>
/// Marks an endpoint as reachable by any client, including none at all.
///
/// Only for the handful that have to work before compatibility is known: the
/// version handshake itself, health, and an invite preview — which is read by
/// somebody who may not have Foxfire installed yet.
/// </summary>
public sealed class AllowAnyDesktopVersionAttribute : Attribute;

/// <summary>
/// Turns away clients this server does not speak to.
///
/// "Incompatible version means no service" is the rule, and this is where it is
/// enforced — once, in front of every API route, rather than as a check each
/// endpoint could forget. A refused client gets 426 Upgrade Required with what
/// would work, so it can say something specific instead of showing an
/// unexplained failure.
///
/// Desktops are judged by version, against an exact allow list. A build that is
/// on the list but behind gets served normally, with a header saying it is
/// behind. That is the grace window: without it, a host upgrading their server
/// cuts off every friend at once. From 0.14.0 a desktop uses that window to
/// update itself to the recommended build, so the window is what turns an
/// upgrade here into something nobody else has to act on.
///
/// The web client is judged by the API version its page was built against. It
/// ships inside this server, so a mismatch only ever means a tab left open
/// across an upgrade, and the remedy is a reload rather than a download.
///
/// Only API routes are gated. The web client's pages and files are served to
/// anybody — they are the same for everybody, and a browser opening one has not
/// said anything about itself yet.
/// </summary>
public sealed class DesktopVersionGate(RequestDelegate next, ILogger<DesktopVersionGate> logger)
{
    /// <summary>What a client sends its identity as.</summary>
    public const string HeaderName = ClientIdentity.HeaderName;

    /// <summary>Set on a served response when the caller is behind but still supported.</summary>
    public const string UpgradeAdvisoryHeader = "X-Foxfire-Upgrade-Available";

    public async Task InvokeAsync(HttpContext context, DesktopAllowList allowList)
    {
        if (!ApiPaths.IsApi(context.Request.Path)
            || context.GetEndpoint()?.Metadata.GetMetadata<AllowAnyDesktopVersionAttribute>() is not null)
        {
            await next(context);
            return;
        }

        switch (ClientIdentity.Read(context.Request))
        {
            case ClientIdentity.Web web:
                if (web.ApiVersion is { } apiVersion && DesktopCompatibility.ServesWebApiVersion(apiVersion))
                {
                    await next(context);
                    return;
                }

                logger.LogInformation(
                    "Refused a web page built against API version {Claimed}; this server serves {Served}",
                    web.ApiVersion?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "(none)",
                    string.Join(", ", DesktopCompatibility.WebApiVersions));

                context.Response.StatusCode = StatusCodes.Status426UpgradeRequired;
                await context.Response.WriteAsJsonAsync(new
                {
                    error = "unsupported_client",
                    message = "Foxfire was updated. Reload the page.",
                    apiVersion = DesktopCompatibility.ApiVersion
                });
                return;

            case ClientIdentity.Desktop desktop:
                await JudgeDesktop(context, allowList, desktop.Version);
                return;

            default:
                await JudgeDesktop(context, allowList, claimed: null);
                return;
        }
    }

    private async Task JudgeDesktop(HttpContext context, DesktopAllowList allowList, string? claimed)
    {
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
