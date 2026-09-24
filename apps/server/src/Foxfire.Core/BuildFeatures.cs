namespace Foxfire.Core;

/// <summary>
/// What this build of the server was compiled with.
///
/// Decided when the server is built, not when it runs: <c>FEATURE_YOUTUBE</c>
/// is defined by Directory.Build.props when the FOXFIRE_FEATURE_YOUTUBE
/// environment variable is on, and the release workflow sets that from the same
/// repository variable the desktop's installer and the web client are built
/// with. A host cannot switch a feature on that their build left off, and the
/// web client inside the build always agrees with the server serving it.
///
/// Read-only fields rather than constants, so a branch on one is not code the
/// compiler reports as unreachable in whichever build leaves it off.
/// </summary>
public static class BuildFeatures
{
    /// <summary>
    /// Recordings on YouTube: attaching a video to one player's row of a game,
    /// the row advertising it, and the page frame and script that play it. Off
    /// until Foxfire's Google project has been through YouTube's review.
    /// </summary>
    public static readonly bool YouTubeRecordings =
#if FEATURE_YOUTUBE
        true;
#else
        false;
#endif
}
