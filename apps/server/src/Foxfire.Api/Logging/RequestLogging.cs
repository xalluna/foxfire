using System.Diagnostics;
using System.Security.Claims;
using Foxfire.Api.Common;
using Foxfire.Api.Versioning;
using Serilog;
using Serilog.Context;
using Serilog.Events;

namespace Foxfire.Api.Logging;

/// <summary>
/// One line for every request, and who made it on every line a request writes.
///
/// The request line is what an incident is reconstructed from: what was asked
/// for, by which client and which member, from where, and what it got back. It
/// carries the request's trace id, as does every other line written while the
/// request was running — so one id finds everything that happened for it.
///
/// That id is also sent back on every response, as <see cref="TraceHeader"/>,
/// so the person something went wrong for can hand it to whoever reads the logs.
///
/// Never the query string. The hub carries an access token in it, because a
/// WebSocket handshake cannot carry a header.
/// </summary>
public static class RequestLogging
{
    /// <summary>The response header carrying the id that finds a request in the logs.</summary>
    public const string TraceHeader = "X-Trace-Id";

    /// <summary>
    /// First in the pipeline, so the line records what the client actually got —
    /// after the exception handler has turned a throw into a 500 — and so an
    /// exception is written once, by that handler, rather than twice.
    /// </summary>
    public static IApplicationBuilder UseFoxfireRequestLogging(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        app.Use(static (context, next) =>
        {
            // On starting rather than now: the exception handler clears the
            // headers before it writes an error, and an error is the response
            // this is most wanted on.
            if (Activity.Current?.TraceId.ToHexString() is { } traceId)
            {
                context.Response.OnStarting(() =>
                {
                    context.Response.Headers[TraceHeader] = traceId;
                    return Task.CompletedTask;
                });
            }

            return next(context);
        });

        return app.UseSerilogRequestLogging(options =>
        {
            // The host's logger, named, because the middleware otherwise writes
            // to Serilog's static one — which this server leaves silent, so
            // that the test suite's several hosts cannot trip over each other.
            options.Logger = app.ApplicationServices.GetRequiredService<Serilog.ILogger>();
            options.GetLevel = (context, _, exception) => LevelFor(context, exception);

            // At the end of the request, by which point the forwarded headers
            // have put the real client address on the connection and
            // authentication has put the member on the request.
            options.EnrichDiagnosticContext = (diagnostics, context) =>
            {
                foreach (var (name, value) in Describe(context)) diagnostics.Set(name, value);

                if (context.GetEndpoint() is RouteEndpoint route)
                {
                    diagnostics.Set("RouteTemplate", route.RoutePattern.RawText);
                }
            };
        });
    }

    /// <summary>
    /// Puts the client, the member and their address on every line the rest of
    /// the request writes — "Deleted the account" is only half a record without
    /// who did it and from where.
    ///
    /// After authentication, which is what says who the member is.
    /// </summary>
    public static IApplicationBuilder UseRequestLogContext(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);

        return app.Use(static async (context, next) =>
        {
            var pushed = Describe(context).Select(p => LogContext.PushProperty(p.Name, p.Value)).ToList();

            try
            {
                await next(context);
            }
            finally
            {
                // Innermost first, as a stack is.
                for (var i = pushed.Count - 1; i >= 0; i--) pushed[i].Dispose();
            }
        });
    }

    /// <summary>
    /// How loud a request's line is.
    ///
    /// Error for anything the server failed at. Warning for being turned away by
    /// a rate limit, which is either somebody guessing passwords or a household
    /// that needs the limit raised — worth a look either way. Debug for the
    /// polling that would otherwise drown everything else out: the health check
    /// and the handshake, which monitors and updaters ask on a timer, and the web
    /// client's own files, which are served before routing and so never reach an
    /// endpoint. Everything else is Information.
    /// </summary>
    public static LogEventLevel LevelFor(HttpContext context, Exception? exception)
    {
        ArgumentNullException.ThrowIfNull(context);

        var status = context.Response.StatusCode;

        if (exception is not null || status >= StatusCodes.Status500InternalServerError) return LogEventLevel.Error;
        if (status == StatusCodes.Status429TooManyRequests) return LogEventLevel.Warning;

        var path = context.Request.Path;
        if (ApiPaths.IsRootMeta(path)) return LogEventLevel.Debug;

        if (path.StartsWithSegments(ApiPaths.Base, out var rest) && ApiPaths.IsRootMeta(rest))
        {
            return LogEventLevel.Debug;
        }

        if (context.GetEndpoint() is null && status < StatusCodes.Status400BadRequest) return LogEventLevel.Debug;

        return LogEventLevel.Information;
    }

    /// <summary>
    /// The address a request came from, as it is written in the logs.
    ///
    /// An IPv4 address arriving on a dual-stack socket reads <c>::ffff:172.20.0.1</c>,
    /// which is the same address spelled so that nobody searching for it would
    /// find it.
    /// </summary>
    public static string? ClientAddress(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        var address = context.Connection.RemoteIpAddress;
        if (address is { IsIPv4MappedToIPv6: true }) address = address.MapToIPv4();

        return address?.ToString();
    }

    /// <summary>
    /// Who a request is from, as properties.
    ///
    /// <c>ClientVersion</c> is a desktop's own version, or for the web client the
    /// API version its page was built against — the web client's version is the
    /// server's own, which every line already carries.
    /// </summary>
    private static List<(string Name, object? Value)> Describe(HttpContext context)
    {
        List<(string Name, object? Value)> properties =
        [
            ("RemoteIp", ClientAddress(context))
        ];

        switch (ClientIdentity.Read(context.Request))
        {
            case ClientIdentity.Desktop desktop:
                properties.Add(("ClientKind", "desktop"));
                properties.Add(("ClientVersion", desktop.Version));
                break;

            case ClientIdentity.Web web:
                properties.Add(("ClientKind", "web"));
                properties.Add(("ClientVersion", web.ApiVersion));
                break;

            default:
                properties.Add(("ClientKind", "unnamed"));
                break;
        }

        if (context.User.FindFirstValue(ClaimTypes.NameIdentifier) is { } userId)
        {
            properties.Add(("UserId", userId));
        }

        return properties;
    }
}
