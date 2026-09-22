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
/// Arithmetic over the season list. Ported from packages/core/src/rules/seasons.ts.
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

    /// <summary>Half-open bounds of one season. Null on either side means unbounded.</summary>
    /// <param name="startMs">
    /// Null for the oldest season, which reaches backwards forever so nothing
    /// older than the first recorded boundary is stranded outside every period.
    /// </param>
    /// <param name="endMs">Null for the newest, which reaches forwards forever.</param>
    public sealed record SeasonBounds(long? StartMs, long? EndMs);

    /// <summary>The window one season covers, or null when no season has that id.</summary>
    public static SeasonBounds? BoundsOf(IReadOnlyList<Season> seasons, int id)
    {
        ArgumentNullException.ThrowIfNull(seasons);

        var index = -1;
        for (var i = 0; i < seasons.Count; i++)
        {
            if (seasons[i].Id == id)
            {
                index = i;
                break;
            }
        }

        if (index < 0) return null;

        return new SeasonBounds(
            StartMs: index == 0 ? null : seasons[index].StartsAt,
            EndMs: index == seasons.Count - 1 ? null : seasons[index + 1].StartsAt);
    }

    /// <summary>
    /// A range as the window it selects.
    ///
    /// The single place a range becomes numbers, so the rank graph and the
    /// champion table can never disagree about what a season covers.
    ///
    /// Both bounds are epoch milliseconds, never a SQL date expression: a date
    /// function resolves in UTC while a hand-entered boundary is local, and the
    /// two would put a changeover-day game in different seasons on different
    /// screens.
    ///
    /// An unparseable range, or one naming a season since deleted, selects
    /// everything rather than nothing — a better failure than an empty screen.
    /// </summary>
    /// <param name="range">"all", "7d", "30d", or "season:{id}".</param>
    public static SeasonBounds RangeBounds(string? range, IReadOnlyList<Season> seasons, long nowMs)
    {
        ArgumentNullException.ThrowIfNull(seasons);

        const long DayMs = 86_400_000L;

        if (range == "7d") return new SeasonBounds(nowMs - (7 * DayMs), null);
        if (range == "30d") return new SeasonBounds(nowMs - (30 * DayMs), null);

        if (range is not null
            && range.StartsWith("season:", StringComparison.Ordinal)
            && int.TryParse(range["season:".Length..], out var id))
        {
            return BoundsOf(seasons, id) ?? new SeasonBounds(null, null);
        }

        return new SeasonBounds(null, null);
    }

    /// <summary>
    /// The seasons a span of history touches, newest first.
    ///
    /// Contiguous by construction, so this is a slice rather than a filter:
    /// every season between the one holding the oldest record and the one
    /// holding the newest is included, whether or not it has games in it. A
    /// season somebody sat out still belongs in the picker; a hole there reads
    /// as lost data.
    /// </summary>
    public static IReadOnlyList<Season> Spanning(IReadOnlyList<Season> seasons, long oldestMs, long newestMs)
    {
        ArgumentNullException.ThrowIfNull(seasons);

        var first = SeasonAt(seasons, oldestMs);
        var last = SeasonAt(seasons, newestMs);
        if (first is null || last is null) return [];

        var from = seasons.ToList().FindIndex(s => s.Id == first.Id);
        var to = seasons.ToList().FindIndex(s => s.Id == last.Id);

        return [.. seasons.Skip(from).Take(to - from + 1).Reverse()];
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
