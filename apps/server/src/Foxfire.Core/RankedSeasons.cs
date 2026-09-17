namespace Foxfire.Core;

/// <summary>
/// A ranked season boundary, entered by hand.
///
/// Riot publishes no way to ask which season is current, and the calendar is not
/// a stand-in for one — 2026 opened on 8 January, and a preseason can run into
/// February. So these are typed in and stored, and everything about seasons is
/// a pure function of the list plus a timestamp.
/// </summary>
/// <param name="StartsAt">Epoch milliseconds, local as entered.</param>
/// <param name="ResetsRank">
/// Whether the ladder was actually emptied at this boundary. Distinct from being
/// a boundary at all: rank carries into a preseason, and Riot has reset mid-year
/// without one.
/// </param>
public sealed record Season(int Id, string Label, long StartsAt, bool IsPreseason, bool ResetsRank);

/// <summary>
/// Arithmetic over the season list. Ported from the desktop's src/shared/seasons.ts.
///
/// Every list passed in must be ordered oldest first, which is how it comes back
/// out of the database.
/// </summary>
public static class RankedSeasons
{
    /// <summary>
    /// The season a moment falls in, or null when the list is empty.
    ///
    /// The oldest season reaches backwards forever and the newest forwards
    /// forever, so with at least one row every moment has an answer. That keeps
    /// a missing future boundary from cutting the current season short, and
    /// stops history older than the first recorded boundary vanishing out of
    /// every period view.
    /// </summary>
    public static Season? SeasonAt(IReadOnlyList<Season> seasons, long ms)
    {
        ArgumentNullException.ThrowIfNull(seasons);
        if (seasons.Count == 0) return null;

        // Walk backwards: the answer is the newest season that had already
        // started, and falling off the front means older than anything recorded,
        // which the oldest season absorbs.
        for (var i = seasons.Count - 1; i > 0; i--)
        {
            if (ms >= seasons[i].StartsAt) return seasons[i];
        }

        return seasons[0];
    }

    /// <summary>
    /// Whether the ladder was reset between two moments.
    ///
    /// The guard that keeps a reset from being recorded as a game that lost two
    /// thousand LP — see <see cref="RankAttribution"/>.
    ///
    /// Deliberately not "are these in the same season". A season boundary and a
    /// ladder reset are different events, so only a boundary that actually reset
    /// counts and a game either side of a carry-over boundary still gets its LP.
    ///
    /// The interval is exclusive below and inclusive above, matching how a
    /// snapshot pair is read everywhere else.
    /// </summary>
    public static bool ResetsBetween(IReadOnlyList<Season> seasons, long afterMs, long untilMs)
    {
        ArgumentNullException.ThrowIfNull(seasons);

        foreach (var season in seasons)
        {
            if (season.ResetsRank && season.StartsAt > afterMs && season.StartsAt <= untilMs)
            {
                return true;
            }
        }

        return false;
    }
}
