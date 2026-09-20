using System.Net;
using Foxfire.Api.Common;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.Replays;

/// <summary>A replay this server holds, as anybody on it sees one.</summary>
/// <param name="Patch">
/// What is needed to play it. Whether the person reading this has one is theirs
/// to know — the server says which, and the desktop checks its own installs.
/// </param>
public sealed record SharedReplayResponse(
    string MatchId,
    string? Patch,
    string? GameVersion,
    long? FileBytes,
    int? DurationSeconds,
    string? UploadedBy,
    DateTimeOffset? UploadedAt)
{
    public static SharedReplayResponse Describe(SharedReplay replay)
    {
        ArgumentNullException.ThrowIfNull(replay);

        return new SharedReplayResponse(
            replay.MatchId,
            replay.Patch,
            replay.GameVersion,
            replay.FileBytes,
            replay.DurationSeconds,
            replay.UploadedBy?.UserName,
            replay.UploadedAt);
    }
}

/// <summary>
/// The answers this feature shares, and the one rule about claims.
/// </summary>
internal static class Replays
{
    /// <summary>
    /// How long an unfinished claim holds a match.
    ///
    /// Longer than any upload and shorter than the evening. A claim that never
    /// completed is somebody who closed their laptop mid-upload, and the game is
    /// still worth having from whoever else was in it.
    /// </summary>
    public static readonly TimeSpan ClaimLifetime = TimeSpan.FromMinutes(30);

    /// <summary>
    /// What a server with no blob store says.
    ///
    /// 503 rather than 404, and its own code: the difference between "this
    /// server does not do replays" and "it does and has not got that one" is the
    /// difference between hiding the affordance and showing it greyed out.
    /// </summary>
    public static Error NotOffered { get; } =
        new("replays_unavailable", "This server is not set up to share replays.");

    public const HttpStatusCode NotOfferedStatus = HttpStatusCode.ServiceUnavailable;
}
