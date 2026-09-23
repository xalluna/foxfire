using Foxfire.Api.Configuration;
using Foxfire.Api.Logging;
using Microsoft.AspNetCore.Http;
using Serilog.Events;

namespace Foxfire.Api.Tests;

/// <summary>
/// How loud each request is, and what the server refuses to start with.
///
/// The levels are worth pinning because getting them wrong fails in two
/// directions, both quietly: too loud and the health check a monitor polls
/// every few seconds buries the lines anybody wants; too quiet and a 500 is
/// written at a level nobody has switched on.
/// </summary>
public class LoggingConfigurationTests
{
    private static HttpContext Request(string path, int status, bool routed = true)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.Response.StatusCode = status;

        if (routed) context.SetEndpoint(new Endpoint(_ => Task.CompletedTask, EndpointMetadataCollection.Empty, "test"));

        return context;
    }

    [Theory]
    [InlineData("/api/matches", 500)]
    [InlineData("/api/matches", 503)]
    public void A_request_the_server_failed_is_an_error(string path, int status) =>
        Assert.Equal(LogEventLevel.Error, RequestLogging.LevelFor(Request(path, status), null));

    [Fact]
    public void A_request_that_threw_is_an_error_whatever_its_status_says() =>
        Assert.Equal(
            LogEventLevel.Error,
            RequestLogging.LevelFor(Request("/api/matches", 200), new InvalidOperationException()));

    [Fact]
    public void Being_turned_away_by_a_rate_limit_is_a_warning() =>
        Assert.Equal(LogEventLevel.Warning, RequestLogging.LevelFor(Request("/api/auth/login", 429), null));

    [Theory]
    [InlineData("/health")]
    [InlineData("/version")]
    [InlineData("/api/health")]
    [InlineData("/api/version")]
    public void What_monitors_and_updaters_poll_is_debug(string path) =>
        Assert.Equal(LogEventLevel.Debug, RequestLogging.LevelFor(Request(path, 200), null));

    [Fact]
    public void A_web_client_file_served_before_routing_is_debug() =>
        Assert.Equal(
            LogEventLevel.Debug,
            RequestLogging.LevelFor(Request("/assets/app-abc123.js", 200, routed: false), null));

    [Theory]
    [InlineData("/api/matches", 200, true)]
    [InlineData("/api/auth/login", 401, true)]
    [InlineData("/api/no-such-route", 404, true)]
    [InlineData("/assets/missing.js", 404, false)]
    [InlineData("/search", 200, true)]
    public void Everything_else_is_information(string path, int status, bool routed) =>
        Assert.Equal(LogEventLevel.Information, RequestLogging.LevelFor(Request(path, status, routed), null));

    private static IReadOnlyList<string> Check(LogOptions logs) =>
        ConfigurationCheck.Validate(
            "Server=db;Database=Foxfire",
            new ServerOptions { PublicUrl = "https://foxfire.example.com" },
            new RiotOptions { ApiKey = "RGAPI-test" },
            new AuthOptions
            {
                JwtSigningKey = "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=",
                InviteSigningKey = "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg="
            },
            new AdminOptions { Email = "admin@example.com" },
            new RateLimitOptions(),
            logs);

    [Fact]
    public void The_defaults_start() =>
        Assert.Empty(Check(new LogOptions()));

    [Fact]
    public void Keeping_logs_for_good_starts() =>
        Assert.Empty(Check(new LogOptions { RetentionDays = 0 }));

    [Fact]
    public void A_console_format_that_is_not_one_is_refused() =>
        Assert.Contains(Check(new LogOptions { ConsoleFormat = "xml" }), p => p.StartsWith("Logs__ConsoleFormat", StringComparison.Ordinal));

    [Fact]
    public void A_negative_retention_is_refused() =>
        Assert.Contains(Check(new LogOptions { RetentionDays = -1 }), p => p.StartsWith("Logs__RetentionDays", StringComparison.Ordinal));
}
