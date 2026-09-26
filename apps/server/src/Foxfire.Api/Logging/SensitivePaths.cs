namespace Foxfire.Api.Logging;

/// <summary>
/// Paths as the logs are allowed to see them.
///
/// Some of this server's paths carry a signed token as a segment — the page an
/// invite or reset link opens, and the API routes those pages call. A token in
/// a path is a token in the request line, and the request line is kept in the
/// blob store, sent to whatever sink a host has added, and shown to every admin
/// on the insights page's Logs tab. A reset link read off that tab is an
/// account taken over, so the segment is replaced before the line is written.
///
/// New routes carry their tokens in the body instead, which is the better fix;
/// these are the ones that already have links in people's inboxes and chats
/// pointing at them.
/// </summary>
public static class SensitivePaths
{
    /// <summary>What a token segment reads as in the logs.</summary>
    public const string Placeholder = "{token}";

    /// <summary>Prefixes whose next segment is a token, lowercase, each ending in a slash.</summary>
    private static readonly string[] TokenPrefixes =
    [
        "/invite/",
        "/reset-password/",
        "/verify-email/",
        "/api/invites/",
        "/api/password-resets/"
    ];

    /// <summary>Segments that sit where a token would and are not one — routes of their own.</summary>
    private static readonly string[] NotTokens = ["request"];

    /// <summary>The path, with any token segment replaced by <see cref="Placeholder"/>.</summary>
    public static string Redact(string? path)
    {
        if (string.IsNullOrEmpty(path)) return path ?? "";

        foreach (var prefix in TokenPrefixes)
        {
            if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) continue;

            var start = prefix.Length;
            if (start >= path.Length) return path;

            var end = path.IndexOf('/', start);
            var segment = end < 0 ? path[start..] : path[start..end];

            if (segment.Length == 0 || NotTokens.Contains(segment, StringComparer.OrdinalIgnoreCase)) return path;

            return end < 0
                ? string.Concat(path.AsSpan(0, start), Placeholder)
                : string.Concat(path.AsSpan(0, start), Placeholder, path.AsSpan(end));
        }

        return path;
    }
}
