using Azure;
using Azure.Storage.Blobs;
using Foxfire.Api.Configuration;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Logging;

/// <summary>
/// Deletes logs older than <see cref="LogOptions.RetentionDays"/>, once a day.
///
/// By age rather than by count, so that "thirty days" means thirty days however
/// busy they were. Azure can do this itself with a lifecycle policy, but
/// Azurite — which is what most hosts are running — cannot, and a homelab's
/// disk should not quietly fill with the server's own diary.
///
/// Nothing here is allowed to stop the server. A sweep that fails is a warning,
/// and the next one tries again.
/// </summary>
public sealed class LogRetention(
    LogDestinations destinations,
    IOptions<LogOptions> options,
    TimeProvider time,
    ILogger<LogRetention> log) : BackgroundService
{
    /// <summary>Long enough after boot that the sweep is not competing with it.</summary>
    private static readonly TimeSpan FirstSweep = TimeSpan.FromMinutes(1);

    private static readonly TimeSpan Interval = TimeSpan.FromDays(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var days = options.Value.RetentionDays;
        if (destinations.Blob is null || days == 0) return;

        var container = destinations.Blob.GetBlobContainerClient(FoxfireLogging.ContainerName);

        try
        {
            await Task.Delay(FirstSweep, time, stoppingToken);

            using var timer = new PeriodicTimer(Interval, time);
            do
            {
                try
                {
                    var deleted = await SweepAsync(container, time.GetUtcNow().AddDays(-days), stoppingToken);
                    if (deleted > 0)
                    {
                        log.LogInformation("Deleted {Count} log blob(s) older than {Days} days", deleted, days);
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogWarning(ex, "Could not clear out old logs; trying again tomorrow");
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The server is stopping.
        }
    }

    /// <summary>
    /// Deletes every blob in the container last written before the cutoff.
    ///
    /// Last written rather than read off the name, because an hour's blob is
    /// only ever appended to during that hour — and because this is the one
    /// fact about a blob that a host's own naming could not change.
    /// </summary>
    public static async Task<int> SweepAsync(
        BlobContainerClient container,
        DateTimeOffset cutoff,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(container);

        var deleted = 0;

        try
        {
            await foreach (var blob in container.GetBlobsAsync(cancellationToken: cancellationToken))
            {
                if (blob.Properties.LastModified is not { } written || written >= cutoff) continue;

                await container.DeleteBlobIfExistsAsync(blob.Name, cancellationToken: cancellationToken);
                deleted++;
            }
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            // No container yet: nothing has been logged to it, so there is
            // nothing to clear.
        }

        return deleted;
    }
}
