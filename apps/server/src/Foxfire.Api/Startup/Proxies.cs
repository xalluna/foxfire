using Foxfire.Api.Configuration;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Startup;

/// <summary>
/// Which reverse proxies to believe about who a request is really from.
///
/// A self-hosted server sits behind Caddy or nginx, and every request arrives
/// from the proxy. The proxy says who it was really for in X-Forwarded-For —
/// but so could anybody, so the header is only read from the proxies and
/// networks the host names. Loopback is believed as well, as the framework
/// believes it by default, for a proxy on the same machine outside Docker.
/// </summary>
public static class Proxies
{
    public static IServiceCollection AddFoxfireProxies(this IServiceCollection services)
    {
        // From the options rather than the startup snapshot, so the list is
        // whatever the built host's configuration says — which is also what a
        // test host running with its own proxy relies on.
        services.AddOptions<ForwardedHeadersOptions>()
            .Configure<IOptions<ServerOptions>>((options, server) =>
            {
                options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;

                foreach (var address in server.Value.TrustedProxyAddresses) options.KnownProxies.Add(address);
                foreach (var network in server.Value.TrustedProxyNetworks) options.KnownIPNetworks.Add(network);
            });

        return services;
    }
}
