using Foxfire.Data.Entities;

namespace Foxfire.Api.Sync;

/// <summary>
/// How long a freshly synced account is left alone, and when that ends.
///
/// Per account rather than per person: one member's refresh covers
/// everybody's, which is the point — twenty people opening the same profile
/// should cost one sync, not twenty. Read off the stored timestamps rather
/// than a dictionary in memory, so a restart does not reopen the budget.
///
/// The server refuses a sync inside it, and says when it ends on the sync
/// state and on a finished sync's progress event, so a client can hold its
/// button until then rather than learn the rule by being refused. The rule
/// lives here and nowhere else: this PC alone has none, and a client that
/// copied the two minutes would be wrong the day they changed.
/// </summary>
public static class SyncCooldown
{
    public static readonly TimeSpan Length = TimeSpan.FromMinutes(2);

    /// <summary>
    /// When the account can next be synced. Null for one that never has been —
    /// and in the past, rather than null, for one whose wait is over, so the
    /// answer is the row's and not the clock's.
    /// </summary>
    public static DateTimeOffset? Until(SyncState? state) =>
        state is null ? null : new[] { state.LastFullSyncAt, state.LastDeltaSyncAt }.Max() + Length;
}
