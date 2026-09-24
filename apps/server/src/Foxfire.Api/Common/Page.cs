using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Common;

/// <summary>
/// One page of a list that grows, and how long the whole list is.
///
/// Every read whose answer grows with time or with the community — match
/// history, the finder, the members, used invites, the replay library — answers
/// with this rather than a bare array. The total is there so a screen can say
/// "120 members" rather than "50+", and so a client knows it has reached the
/// end without asking for a page that turns out to be empty. It reaches the
/// wire as <c>{ items, total }</c>.
///
/// A list that cannot grow past a handful by construction — your own accounts,
/// open invites, the seasons — stays a bare array. So does rank history, which
/// is bounded by the range asked for and whose graph needs every point; see
/// <see cref="Foxfire.Api.Reads.RankReads.HistoryAsync"/>.
/// </summary>
/// <param name="Total">How many there are across every page, under the same filters.</param>
public sealed record Page<T>(IReadOnlyList<T> Items, int Total)
{
    /// <summary>Nothing, which is a page too.</summary>
    public static Page<T> Empty { get; } = new([], 0);

    /// <summary>The same page, each row described differently.</summary>
    public Page<TOut> Map<TOut>(Func<T, TOut> describe) => new([.. Items.Select(describe)], Total);
}

/// <summary>
/// How much of a list somebody asked for, once the server has had its say.
///
/// The page size is capped rather than trusted: a caller that leaves it out
/// gets <see cref="DefaultLimit"/>, and one that asks for a hundred thousand
/// gets <see cref="MaxLimit"/>. Nothing is refused for asking — an old client
/// or a hand-typed URL still gets an answer, just not all of it.
/// </summary>
public readonly record struct PageRequest(int Limit, int Offset)
{
    /// <summary>A page, when the caller does not say.</summary>
    public const int DefaultLimit = 50;

    /// <summary>The most one request is answered with, whatever it asks for.</summary>
    public const int MaxLimit = 100;

    public static PageRequest Of(
        int? limit,
        int? offset,
        int defaultLimit = DefaultLimit,
        int maxLimit = MaxLimit) =>
        new(Math.Clamp(limit ?? defaultLimit, 1, maxLimit), Math.Max(offset ?? 0, 0));
}

public static class PagingExtensions
{
    /// <summary>
    /// Counts the list and reads one page of it.
    ///
    /// The query must already be ordered, down to a column that is unique —
    /// otherwise a page boundary can fall between two rows the database orders
    /// differently next time, and one of them is shown twice while another is
    /// never shown at all.
    /// </summary>
    public static async Task<Page<T>> ToPageAsync<T>(
        this IQueryable<T> query,
        PageRequest page,
        CancellationToken cancellationToken)
    {
        var total = await query.CountAsync(cancellationToken);
        if (total == 0 || page.Offset >= total) return new Page<T>([], total);

        var items = await query.Skip(page.Offset).Take(page.Limit).ToListAsync(cancellationToken);
        return new Page<T>(items, total);
    }
}
