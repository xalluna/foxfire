using System.Net;
using System.Text.Json;
using Azure.Storage.Blobs;
using Foxfire.Api.Logging;
using Microsoft.Extensions.Configuration;
using Serilog;
using Serilog.Debugging;

namespace Foxfire.Api.Tests;

/// <summary>
/// That logs land where a host will go looking for them after something breaks.
///
/// Against the real Azurite the fixture runs, because the claim is about what is
/// in the store afterwards, and the ways it fails — a batch that is never
/// flushed, a property that never makes it onto the line, a sink that quietly
/// is not there — are invisible from inside the process.
///
/// In the server's collection even where no server is needed: Serilog reports
/// its own failures through one process-wide channel, the sink tests read it,
/// and every host this suite builds points it at the console as it starts.
/// Running alongside them, a test could have its evidence redirected mid-read.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public sealed class LoggingTests(FoxfireServerFixture server)
{
    private BlobServiceClient Store => new(server.BlobConnectionString);

    /// <summary>
    /// The whole chain: a request, its line in the blob store, and the id on the
    /// response that finds it.
    ///
    /// On a host of its own, because disposing a host is what flushes its last
    /// batch — the fixture's own host lives until the suite ends.
    /// </summary>
    [Fact]
    public async Task A_request_is_kept_in_the_blob_store_under_the_id_its_response_carried()
    {
        var marker = Guid.NewGuid().ToString("N");
        var secret = $"secret-{Guid.NewGuid():N}";
        var path = $"/api/no-such-route-{marker}";

        var host = server.Factory.WithWebHostBuilder(_ => { });
        string traceId;

        try
        {
            using var client = host.CreateClient();
            client.DefaultRequestHeaders.Add("X-Foxfire-Client", FoxfireServerFixture.CurrentDesktop);

            var response = await client.GetAsync(new Uri(path, UriKind.Relative));
            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            traceId = Assert.Single(response.Headers.GetValues(RequestLogging.TraceHeader));

            // The one route that carries a token in its query string.
            await client.GetAsync(new Uri($"/api/hub?access_token={secret}", UriKind.Relative));
        }
        finally
        {
            await host.DisposeAsync();
        }

        var lines = await LogLinesAsync();

        var line = Assert.Single(lines, l => l.TryGetProperty("RequestPath", out var p) && p.GetString() == path);
        Assert.Equal(traceId, line.GetProperty("@tr").GetString());
        Assert.Equal(404, line.GetProperty("StatusCode").GetInt32());
        Assert.Equal("desktop", line.GetProperty("ClientKind").GetString());
        Assert.Equal(FoxfireServerFixture.CurrentDesktop, line.GetProperty("ClientVersion").GetString());
        Assert.Equal("Foxfire.Server", line.GetProperty("Application").GetString());

        // Information, which compact JSON writes by leaving the level off.
        Assert.False(line.TryGetProperty("@l", out _));

        Assert.DoesNotContain(lines, l => l.GetRawText().Contains(secret, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Logs_older_than_the_cutoff_are_cleared_and_newer_ones_kept()
    {
        // A container of its own. The server's is being written to throughout
        // the suite, and the sink does not recover from its current hour's blob
        // disappearing underneath it.
        var container = Store.GetBlobContainerClient($"logs-sweep-{Guid.NewGuid():N}");
        await container.CreateIfNotExistsAsync();

        try
        {
            await container.UploadBlobAsync("2026/01/01/00.clef", BinaryData.FromString("{}\n"));
            await container.UploadBlobAsync("2026/01/01/01.clef", BinaryData.FromString("{}\n"));

            Assert.Equal(0, await LogRetention.SweepAsync(container, DateTimeOffset.UtcNow.AddDays(-1)));
            Assert.Equal(2, await LogRetention.SweepAsync(container, DateTimeOffset.UtcNow.AddMinutes(5)));

            await foreach (var _ in container.GetBlobsAsync())
            {
                Assert.Fail("The sweep left a blob behind");
            }
        }
        finally
        {
            await container.DeleteIfExistsAsync();
        }
    }

    [Fact]
    public async Task A_sweep_before_anything_has_been_logged_finds_nothing_to_do()
    {
        var container = Store.GetBlobContainerClient($"logs-absent-{Guid.NewGuid():N}");

        Assert.Equal(0, await LogRetention.SweepAsync(container, DateTimeOffset.UtcNow));
    }

    /// <summary>
    /// Each destination docker-compose.yml offers, spelled as it spells it.
    ///
    /// Serilog skips a sink it cannot find and says so only to its own error
    /// channel, so a sink that stopped resolving — a package dropped, or the
    /// single-file release build, where Serilog's own search finds nothing —
    /// would leave a host's logs going nowhere with the server looking healthy.
    /// </summary>
    [Theory]
    [InlineData("file")]
    [InlineData("otlp")]
    [InlineData("seq")]
    [InlineData("appinsights")]
    public void Every_sink_a_host_can_choose_is_in_the_server(string sink)
    {
        var files = Path.Combine(Path.GetTempPath(), $"foxfire-logs-{Guid.NewGuid():N}");

        try
        {
            var complaints = ConfigureCapturingSelfLog(ComposeExample(sink, files));
            Assert.DoesNotContain(complaints, c => c.Contains("Unable to find", StringComparison.Ordinal));
        }
        finally
        {
            if (Directory.Exists(files)) Directory.Delete(files, recursive: true);
        }
    }

    /// <summary>That the test above can fail: a sink that does not exist is reported.</summary>
    [Fact]
    public void A_sink_the_server_does_not_have_is_reported()
    {
        var complaints = ConfigureCapturingSelfLog(new Dictionary<string, string?>
        {
            ["Serilog:WriteTo:nope:Name"] = "NoSuchSink"
        });

        Assert.Contains(complaints, c => c.Contains("Unable to find a method called NoSuchSink", StringComparison.Ordinal));
    }

    /// <summary>The commented-out blocks in docker-compose.yml, as configuration.</summary>
    private static Dictionary<string, string?> ComposeExample(string sink, string files) => sink switch
    {
        "file" => new()
        {
            ["Serilog:WriteTo:file:Name"] = "File",
            ["Serilog:WriteTo:file:Args:path"] = Path.Combine(files, "foxfire-.clef"),
            ["Serilog:WriteTo:file:Args:rollingInterval"] = "Day",
            ["Serilog:WriteTo:file:Args:retainedFileCountLimit"] = "30",
            ["Serilog:WriteTo:file:Args:formatter"] =
                "Serilog.Formatting.Compact.CompactJsonFormatter, Serilog.Formatting.Compact"
        },
        "otlp" => new()
        {
            ["Serilog:WriteTo:otlp:Name"] = "OpenTelemetry",
            ["Serilog:WriteTo:otlp:Args:endpoint"] = "http://otel-collector:4317",
            ["Serilog:WriteTo:otlp:Args:protocol"] = "Grpc"
        },
        "seq" => new()
        {
            ["Serilog:WriteTo:seq:Name"] = "Seq",
            ["Serilog:WriteTo:seq:Args:serverUrl"] = "http://seq:5341"
        },
        "appinsights" => new()
        {
            ["Serilog:WriteTo:appinsights:Name"] = "ApplicationInsights",
            ["Serilog:WriteTo:appinsights:Args:connectionString"] =
                "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.invalid/",
            ["Serilog:WriteTo:appinsights:Args:telemetryConverter"] =
                "Serilog.Sinks.ApplicationInsights.TelemetryConverters.TraceTelemetryConverter, Serilog.Sinks.ApplicationInsights"
        },
        _ => throw new ArgumentOutOfRangeException(nameof(sink), sink, "No such example")
    };

    private static List<string> ConfigureCapturingSelfLog(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        List<string> complaints = [];

        SelfLog.Enable(message =>
        {
            lock (complaints) complaints.Add(message);
        });

        try
        {
            using var logger = new LoggerConfiguration()
                .ReadFrom.Configuration(configuration, FoxfireLogging.ReaderOptions())
                .CreateLogger();
        }
        finally
        {
            SelfLog.Enable(Console.Error);
        }

        lock (complaints) return [.. complaints];
    }

    /// <summary>Every line in the server's log container, parsed.</summary>
    private async Task<List<JsonElement>> LogLinesAsync()
    {
        var container = Store.GetBlobContainerClient(FoxfireLogging.ContainerName);
        List<JsonElement> lines = [];

        await foreach (var blob in container.GetBlobsAsync())
        {
            var content = await container.GetBlobClient(blob.Name).DownloadContentAsync();

            foreach (var text in content.Value.Content.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                using var line = JsonDocument.Parse(text);
                lines.Add(line.RootElement.Clone());
            }
        }

        return lines;
    }
}
