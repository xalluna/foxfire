namespace Foxfire.Core;

/// <summary>One account's history of one game, as a background sweep sees it.</summary>
/// <param name="LastSyncedAt">When a sync last finished cleanly for it. Null for one that never has.</param>
public sealed record BackgroundSyncCandidate(Guid RiotAccountId, Game Game, DateTimeOffset? LastSyncedAt);

/// <summary>
/// When the server syncs everybody by itself, and whom it leaves alone.
///
/// The sweep exists for the members nothing else syncs: an owner who is not
/// running Foxfire arms no post-game ladder, and an account an admin added has
/// no owner to press Sync now. Without it their rank readings stop, and the LP
/// graph draws a straight line across every game they played in between.
///
/// Decided here, without a database or a clock of its own, for the same reason
/// as <see cref="SyncPlanning"/>: these are the rules worth testing directly.
/// </summary>
public static class BackgroundSyncRules
{
    /// <summary>
    /// Every half hour. Often enough that a graph a member opens is at most one
    /// evening's game behind, and at three or four requests an account when
    /// nothing is new, a small share of one personal key for a community.
    /// </summary>
    public const int IntervalMinutesDefault = 30;

    /// <summary>
    /// Anybody synced in the last quarter hour is left alone. Their own client,
    /// a post-game ladder or a co-player's sync has just done what the sweep
    /// would, and asking Riot again would spend the key on nothing.
    /// </summary>
    public const int SkipMinutesDefault = 15;

    /// <summary>
    /// The shortest interval an admin may choose. Below it a sweep of a big
    /// community would barely finish before the next began.
    /// </summary>
    public const int MinIntervalMinutes = 10;

    /// <summary>A day: anything longer is not keeping a graph current.</summary>
    public const int MaxIntervalMinutes = 1440;

    public const int MinSkipMinutes = 1;

    /// <summary>
    /// Whether an interval and a skip window can stand together.
    ///
    /// The window has to be shorter than the interval. A sweep reaches each
    /// account about one interval after the last sweep synced it, so a window as
    /// long as the interval would skip everybody the previous sweep reached, and
    /// "every fifteen minutes" would quietly mean every thirty.
    /// </summary>
    public static bool Fits(int intervalMinutes, int skipMinutes) =>
        skipMinutes >= MinSkipMinutes && skipMinutes < intervalMinutes;

    /// <summary>Whether it is time to start another sweep. Null means none has run in this process.</summary>
    public static bool IsSweepDue(DateTimeOffset? lastSweepStartedAt, DateTimeOffset now, TimeSpan interval) =>
        lastSweepStartedAt is not { } last || now - last >= interval;

    /// <summary>Whether a history was synced recently enough that the sweep should leave it alone.</summary>
    public static bool IsFresh(DateTimeOffset? lastSyncedAt, DateTimeOffset now, TimeSpan skip) =>
        lastSyncedAt is { } last && now - last < skip;

    /// <summary>
    /// The order a sweep works through: the stalest history first, and the
    /// never-synced after everything else.
    ///
    /// Stalest first so that a sweep cut short — the server stopping, an admin
    /// turning it off — has spent itself where it was most needed. Never-synced
    /// last because that is a backfill: an account whose first sync did not
    /// finish, or one from before TFT whose TFT history was never fetched. A
    /// backfill is up to a request a game, and a first sweep should bring
    /// everybody's existing history up to date before it spends an hour on one.
    /// Ties go by account and game, so the order is the same every time.
    /// </summary>
    public static IReadOnlyList<BackgroundSyncCandidate> Order(IEnumerable<BackgroundSyncCandidate> candidates)
    {
        ArgumentNullException.ThrowIfNull(candidates);

        return
        [
            .. candidates
                .OrderBy(c => c.LastSyncedAt is null)
                .ThenBy(c => c.LastSyncedAt)
                .ThenBy(c => c.RiotAccountId)
                .ThenBy(c => c.Game)
        ];
    }
}
