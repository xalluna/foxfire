using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Foxfire.Storage;

/// <summary>
/// Replays in an Azure Blob container — or in Azurite, which is the same API.
///
/// Azurite is what docker-compose.yml runs, and it is not a mock: it speaks the
/// real protocol, signs real SAS tokens and enforces them, so a self-hoster with
/// no cloud account and somebody paying Microsoft are running the same code down
/// to the signature. That is why this is the only implementation rather than one
/// of two.
///
/// Nothing here ever holds a replay. The desktop is handed a signed URL and
/// PUTs the bytes to the store directly; this class mints URLs, asks how big
/// things are, and deletes. A 30 MB file through a homelab's API process would
/// be somebody's upstream spent twice and a request held open for the length of
/// an upload, for no gain at all.
/// </summary>
public sealed class AzureBlobReplayStorage : IReplayStorage
{
    /// <summary>
    /// One container, named rather than configurable.
    ///
    /// A connection string already points at an account, and a host who wants
    /// replays kept apart from something else can point it at a different one.
    /// A second knob for the container name would only be a second thing to get
    /// wrong.
    /// </summary>
    public const string ContainerName = "replays";

    /// <summary>
    /// How long a signed URL is good for.
    ///
    /// Fifteen minutes covers a 30 MB upload on a slow domestic connection with
    /// room to spare, and the desktop asks for a fresh one if it does not. The
    /// URL is a bearer credential for one blob, so the cost of being generous is
    /// that a copied link keeps working for that long.
    /// </summary>
    public static readonly TimeSpan GrantLifetime = TimeSpan.FromMinutes(15);

    /// <summary>
    /// Clock skew allowance on the signature's start time.
    ///
    /// A homelab and Azurite in a container beside it can disagree by a few
    /// seconds, and a SAS that is not valid yet fails in a way that reads as a
    /// permissions problem rather than as a clock.
    /// </summary>
    private static readonly TimeSpan StartSkew = TimeSpan.FromMinutes(5);

    private readonly BlobContainerClient? _container;
    private readonly ILogger _log;

    public AzureBlobReplayStorage(string? connectionString, ILogger<AzureBlobReplayStorage>? logger = null)
    {
        _log = logger ?? NullLogger<AzureBlobReplayStorage>.Instance;

        if (string.IsNullOrWhiteSpace(connectionString)) return;

        try
        {
            _container = new BlobServiceClient(connectionString).GetBlobContainerClient(ContainerName);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            // A malformed connection string is a configuration problem, and the
            // server still serves everything that is not a replay — so it is
            // reported and the feature turns itself off, rather than the whole
            // thing refusing to start over an optional store.
            _log.LogError(ex, "The blob connection string could not be parsed; replay sharing is off");
        }
    }

    public bool IsConfigured => _container is not null;

    public async Task PrepareAsync(CancellationToken cancellationToken = default)
    {
        if (_container is null) return;

        try
        {
            // Private, always. A public container would make every replay on the
            // server readable by anyone who guessed a match id, and match ids are
            // sequential.
            await _container.CreateIfNotExistsAsync(PublicAccessType.None, cancellationToken: cancellationToken);
        }
        catch (RequestFailedException ex)
        {
            throw new ReplayStorageException("Could not reach the blob store.", ex);
        }
    }

    public Task<StorageGrant> GrantUploadAsync(string matchId, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(matchId);

        var key = BlobKeyFor(matchId);
        return Task.FromResult(Sign(key, BlobSasPermissions.Write | BlobSasPermissions.Create));
    }

    public Task<StorageGrant> GrantDownloadAsync(string blobKey, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(blobKey);
        return Task.FromResult(Sign(blobKey, BlobSasPermissions.Read));
    }

    public async Task<long?> SizeOfAsync(string blobKey, CancellationToken cancellationToken = default)
    {
        var blob = Blob(blobKey);

        try
        {
            var properties = await blob.GetPropertiesAsync(cancellationToken: cancellationToken);
            return properties.Value.ContentLength;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            // Not an error. It is the answer to "did the upload actually land",
            // and no is a perfectly ordinary one.
            return null;
        }
        catch (RequestFailedException ex)
        {
            throw new ReplayStorageException($"Could not read {blobKey} from the blob store.", ex);
        }
    }

    public async Task DeleteAsync(string blobKey, CancellationToken cancellationToken = default)
    {
        try
        {
            await Blob(blobKey).DeleteIfExistsAsync(cancellationToken: cancellationToken);
        }
        catch (RequestFailedException ex)
        {
            throw new ReplayStorageException($"Could not delete {blobKey} from the blob store.", ex);
        }
    }

    /// <summary>
    /// Adds up what is in the container.
    ///
    /// A listing rather than a stored running total, because the two would
    /// eventually disagree and the store is the one that would be right. A
    /// community's replay library is thousands of blobs at most, and this is
    /// read by an admin panel rather than by a page of match history.
    /// </summary>
    public async Task<StorageUsage> UsageAsync(CancellationToken cancellationToken = default)
    {
        if (_container is null) return new StorageUsage(0, 0);

        var total = 0L;
        var count = 0;

        try
        {
            await foreach (var blob in _container.GetBlobsAsync(cancellationToken: cancellationToken))
            {
                total += blob.Properties.ContentLength ?? 0;
                count++;
            }
        }
        catch (RequestFailedException ex)
        {
            throw new ReplayStorageException("Could not list the blob store.", ex);
        }

        return new StorageUsage(total, count);
    }

    /// <summary>
    /// Where one match's replay lives.
    ///
    /// Riot's match id, which is already unique and already known before the
    /// file arrives, so nothing has to be generated and nothing has to be looked
    /// up to find a blob again. The platform prefix becomes a folder purely so a
    /// person poking at the container with Storage Explorer sees something
    /// navigable.
    /// </summary>
    public static string BlobKeyFor(string matchId)
    {
        var split = matchId.IndexOf('_', StringComparison.Ordinal);
        var platform = split > 0 ? matchId[..split] : "unknown";

        return $"{platform}/{matchId}.rofl";
    }

    private BlobClient Blob(string blobKey) =>
        _container?.GetBlobClient(blobKey)
        ?? throw new ReplayStorageException("No blob store is configured on this server.");

    /// <summary>
    /// One signed URL.
    ///
    /// Requires the connection string to carry an account key — which the
    /// Azurite default does and a real account's does — because a SAS has to be
    /// signed by something. A connection string using a token credential cannot
    /// mint one without a user delegation key, and that is a different feature
    /// for a different kind of host; it fails here with a message saying so
    /// rather than with a null reference.
    /// </summary>
    private StorageGrant Sign(string blobKey, BlobSasPermissions permissions)
    {
        var blob = Blob(blobKey);

        if (!blob.CanGenerateSasUri)
        {
            throw new ReplayStorageException(
                "This blob store's credentials cannot sign a URL. Use a connection string with an "
                + "account key — replays are uploaded by the desktop directly, not through the server.");
        }

        var expiresAt = DateTimeOffset.UtcNow.Add(GrantLifetime);

        var builder = new BlobSasBuilder
        {
            BlobContainerName = ContainerName,
            BlobName = blobKey,
            Resource = "b",
            StartsOn = DateTimeOffset.UtcNow.Subtract(StartSkew),
            ExpiresOn = expiresAt
        };

        builder.SetPermissions(permissions);

        return new StorageGrant(blob.GenerateSasUri(builder), blobKey, expiresAt);
    }
}
