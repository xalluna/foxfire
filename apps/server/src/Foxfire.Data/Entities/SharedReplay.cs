namespace Foxfire.Data.Entities;

/// <summary>
/// Riot's own replay of a game, kept once for everybody who played it.
///
/// A .rofl is not a video: it is a command log the game engine replays, which
/// is why it is worth sharing at all — 30 MB buys every camera angle and every
/// player's point of view, and the client that plays it is one everybody
/// already has. It is also why it can stop being playable, which is what
/// <see cref="Patch"/> is for.
///
/// Keyed on the match, so there is exactly one per game whoever uploaded it.
/// Riot produces the same file for all ten players — the log is of the game, not
/// of a viewpoint — so a second copy would be the same bytes under a different
/// name.
///
/// The bytes are not here. They are in the blob store, at <see cref="BlobKey"/>,
/// and no request to this server ever carries them: the desktop is handed a
/// signed URL and uploads directly. This row is the record that it did.
/// </summary>
public sealed class SharedReplay
{
    /// <summary>Riot's match id, which is the key and the dedup rule at once.</summary>
    public required string MatchId { get; set; }

    /// <summary>
    /// The match this belongs to, when the server has fetched it.
    ///
    /// Not a foreign key, deliberately. A .rofl lands on disk minutes before
    /// match-v5 publishes the game it is of, so requiring the match to exist
    /// first would refuse exactly the upload that happens at the moment somebody
    /// is most likely to want it. The id is Riot's either way, so the link
    /// resolves itself the moment the sync lands.
    /// </summary>
    public string? BlobKey { get; set; }

    /// <summary>Bytes, as the store reported them. Null until the upload is verified.</summary>
    public long? FileBytes { get; set; }

    /// <summary>Straight off the .rofl header, e.g. "15.16.700.1234".</summary>
    public string? GameVersion { get; set; }

    /// <summary>
    /// The major.minor reduction of it, which is what decides playability.
    ///
    /// Riot ships hotfixes inside a patch without breaking replay
    /// compatibility, so the build and hotfix digits are dropped: requiring them
    /// to agree would orphan a replay recorded four hours ago and look,
    /// correctly, like a bug.
    ///
    /// Whether a given viewer can play it is not decided here. It depends on
    /// which League installs are on their machine, which is theirs to know — the
    /// server says which patch is needed and the desktop says whether it has one.
    /// </summary>
    public string? Patch { get; set; }

    public int? DurationSeconds { get; set; }

    /// <summary>
    /// Who uploaded it, or null once they have left.
    ///
    /// SET NULL rather than cascade: the replay belongs to the community now.
    /// Deleting somebody's account must not take the only copy of a game nine
    /// other people were also in.
    /// </summary>
    public Guid? UploadedByUserId { get; set; }
    public FoxfireUser? UploadedBy { get; set; }

    /// <summary>When the claim was made. Not when the bytes arrived.</summary>
    public DateTimeOffset ClaimedAt { get; set; }

    /// <summary>
    /// When the store confirmed the bytes were there. Null while an upload is
    /// in flight, or was abandoned.
    /// </summary>
    public DateTimeOffset? UploadedAt { get; set; }

    /// <summary>
    /// Offered for download only once the store has been asked how big it is.
    ///
    /// The desktop reporting that it finished is not evidence — an upload can be
    /// interrupted, and a half-written blob offered to somebody else is worse
    /// than no blob at all, because the failure happens after the download.
    /// </summary>
    public bool IsAvailable => UploadedAt is not null && BlobKey is not null;
}
