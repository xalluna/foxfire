namespace Foxfire.Api.Reads;

/// <summary>
/// A row of somebody's history, as an outsider is shown it.
///
/// An outsider — a visitor to an open server, or a share link's holder — reads
/// the games. What a member put on them for the community stays with the
/// community: a recording is a video somebody posted for the people they play
/// with, and a shared replay is a download only a member can start, so a row
/// that offered either would be promising something the reader cannot have.
///
/// A handler knows it is answering an outsider by there being nobody signed in;
/// nothing else reaches a read without a member.
/// </summary>
internal static class OutsiderView
{
    public static MatchSummaryResponse Of(MatchSummaryResponse row) =>
        row with { SharedReplay = null, Recording = null };

    public static TftMatchSummaryResponse Of(TftMatchSummaryResponse row) =>
        row with { Recording = null };

    /// <summary>The rows as <paramref name="userId"/> may see them: whole for a member, trimmed for an outsider.</summary>
    public static IReadOnlyList<MatchSummaryResponse> For(Guid? userId, IReadOnlyList<MatchSummaryResponse> rows) =>
        userId is null ? [.. rows.Select(Of)] : rows;

    /// <inheritdoc cref="For(Guid?, IReadOnlyList{MatchSummaryResponse})"/>
    public static IReadOnlyList<TftMatchSummaryResponse> For(Guid? userId, IReadOnlyList<TftMatchSummaryResponse> rows) =>
        userId is null ? [.. rows.Select(Of)] : rows;
}
