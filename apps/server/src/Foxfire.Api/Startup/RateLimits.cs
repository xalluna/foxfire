using System.Globalization;
using System.Threading.RateLimiting;
using Foxfire.Api.Configuration;
using Foxfire.Api.Logging;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace Foxfire.Api.Startup;

/// <summary>
/// Per-address limits on the routes worth abusing.
///
/// Two, and only two. Signing in and registering, because a server reachable
/// from the internet will have somebody trying passwords against it — Identity's
/// lockout protects one account at a time, and this protects all of them from
/// one address. And search, because every search is a live Riot call on the
/// server's single key, shared by the whole community.
///
/// Everything else is unlimited: it is either authenticated and cheap, or a
/// refresh, which no household should ever be able to trip by reloading tabs.
///
/// Per address means per client address, which behind a reverse proxy is only
/// true once the proxy is trusted — see <see cref="ServerOptions.TrustedProxies"/>.
/// </summary>
public static class RateLimits
{
    /// <summary>Signing in and registering.</summary>
    public const string Auth = "auth";

    /// <summary>Looking somebody up through Riot.</summary>
    public const string Search = "search";

    public static IServiceCollection AddFoxfireRateLimits(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.AddPolicy(Auth, http => PerAddress(http, limits => limits.AuthPerMinute));
            options.AddPolicy(Search, http => PerAddress(http, limits => limits.SearchPerMinute));

            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = async (context, cancellationToken) =>
            {
                var wait = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter)
                    ? retryAfter
                    : TimeSpan.FromMinutes(1);
                var seconds = Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds));

                var http = context.HttpContext;
                http.RequestServices.GetRequiredService<ILoggerFactory>()
                    .CreateLogger(typeof(RateLimits).FullName!)
                    .LogWarning(
                        "Turned {Address} away on the {Policy} limit for {Seconds} seconds",
                        RequestLogging.ClientAddress(http) ?? "unknown",
                        http.GetEndpoint()?.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName ?? "unnamed",
                        seconds);

                var response = http.Response;
                response.Headers[HeaderNames.RetryAfter] = seconds.ToString(CultureInfo.InvariantCulture);

                // The shape every other failure on this server has, so a client
                // reads it the same way — and tells it apart from being signed
                // out, which it is not.
                await response.WriteAsJsonAsync(
                    new
                    {
                        error = "rate_limited",
                        message = $"Too many attempts from this address. Try again in {seconds} seconds."
                    },
                    cancellationToken);
            };
        });

        return services;
    }

    private static RateLimitPartition<string> PerAddress(HttpContext http, Func<RateLimitOptions, int> limit)
    {
        // Read per request rather than captured at startup, so a test host can
        // run with its own limits against the same configuration.
        var options = http.RequestServices.GetRequiredService<IOptions<RateLimitOptions>>().Value;
        var address = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        return RateLimitPartition.GetFixedWindowLimiter(address, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = limit(options),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
            AutoReplenishment = true
        });
    }
}
