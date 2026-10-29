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
/// Three. Signing in and registering, because a server reachable from the
/// internet will have somebody trying passwords against it — Identity's lockout
/// protects one account at a time, and this protects all of them from one
/// address. Search, because it is a scan over every tracked account. And reads
/// by outsiders — an open server's visitors, a share link's holder — because
/// those are the requests nobody had to sign in to send.
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

    /// <summary>Finding somebody this server tracks.</summary>
    public const string Search = "search";

    /// <summary>Reading, by somebody who is not signed in. Members pass untouched.</summary>
    public const string Reader = "reader";

    public static IServiceCollection AddFoxfireRateLimits(this IServiceCollection services)
    {
        services.AddRateLimiter(options =>
        {
            options.AddPolicy(Auth, http => PerAddress(http, limits => limits.AuthPerMinute));
            options.AddPolicy(Search, http => PerAddress(http, limits => limits.SearchPerMinute));

            // Decided by whether authentication found a member, which is why
            // the limiter runs after it — see Program.cs. Before, a request
            // carrying any Authorization header at all could have claimed to be
            // one and walked past the limit.
            options.AddPolicy(Reader, http => http.User.Identity?.IsAuthenticated == true
                ? RateLimitPartition.GetNoLimiter("member")
                : PerAddress(http, limits => limits.ReaderPerMinute));

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
                        message = $"Too many requests from this address. Try again in {seconds} seconds."
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
