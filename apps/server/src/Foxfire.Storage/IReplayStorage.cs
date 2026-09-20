namespace Foxfire.Storage;

/// <summary>
/// Permission to put one file somewhere, for a little while.
/// </summary>
/// <param name="Url">
/// A complete, pre-authorised URL. The desktop PUTs the bytes straight to it and
/// this server never sees them — which is the point: a 30 MB replay through a
/// homelab's API process is 30 MB of somebody's upstream spent twice, and a
/// request the server has to hold open for the length of an upload.
/// </param>
/// <param name="BlobKey">Where it will land, as this server files it.</param>
/// <param name="ExpiresAt">
/// Short. Long enough for an upload over a domestic connection and no longer:
/// this URL is a bearer credential for one blob, and the desktop asks again if
/// it runs out.
/// </param>
public sealed record StorageGrant(Uri Url, string BlobKey, DateTimeOffset ExpiresAt);

/// <summary>What a store is currently holding.</summary>
public sealed record StorageUsage(long TotalBytes, int Count);

/// <summary>
/// Where replays live.
///
/// An interface with one implementation, which is worth it for exactly two
/// reasons rather than on principle. The first is that a self-hoster's Azurite
/// container and somebody else's real Azure account are the same code and
/// deliberately so, but a third option — a plain directory, S3, whatever a
/// community already runs — is a request this will eventually get, and the seam
/// is cheaper to leave than to cut later. The second is that it keeps the
/// endpoints honest: nothing above this handles a byte of replay data, because
/// there is nothing in this contract that would let it.
///
/// Everything here is addressed by <c>matchId</c>, which is Riot's own and
/// therefore already unique, already known before the file is fetched, and the
/// same on every server. One replay per game, whoever uploaded it.
/// </summary>
public interface IReplayStorage
{
    /// <summary>Whether a store is configured at all. False means replays are not offered.</summary>
    bool IsConfigured { get; }

    /// <summary>Makes sure the container exists. Called once at startup.</summary>
    Task PrepareAsync(CancellationToken cancellationToken = default);

    /// <summary>A short-lived write URL for one match's replay.</summary>
    Task<StorageGrant> GrantUploadAsync(string matchId, CancellationToken cancellationToken = default);

    /// <summary>A short-lived read URL for one match's replay.</summary>
    Task<StorageGrant> GrantDownloadAsync(string blobKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// The size of what is actually there, or null when nothing is.
    ///
    /// The whole of how an upload is verified. The desktop reports that it
    /// finished; this is the server asking the store rather than believing it.
    /// </summary>
    Task<long?> SizeOfAsync(string blobKey, CancellationToken cancellationToken = default);

    Task DeleteAsync(string blobKey, CancellationToken cancellationToken = default);

    /// <summary>How much is stored, for the admin panel and the byte cap.</summary>
    Task<StorageUsage> UsageAsync(CancellationToken cancellationToken = default);
}

/// <summary>The store could not do it.</summary>
public sealed class ReplayStorageException(string message, Exception? inner = null)
    : Exception(message, inner);
