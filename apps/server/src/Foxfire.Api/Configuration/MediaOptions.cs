namespace Foxfire.Api.Configuration;

/// <summary>
/// Foxfire Media, where this server's recordings are kept and played from.
///
/// Optional, and off unless both are set. Off, the server takes no recordings:
/// the recording routes are not mapped, rows carry none, and /version says so.
/// On, the server is a Foxfire Media application — it mints upload tokens and
/// embeds with its key — and never handles a byte of video itself: the desktop
/// that recorded a game uploads straight to Foxfire Media, and a browser plays
/// straight from it.
///
/// Foxfire Media's side of it is an application entry whose AllowedOrigins
/// holds this server's <see cref="ServerOptions.PublicUrl"/>, whose key is
/// <see cref="ApiKey"/>, and whose WebhookUrl is <c>{PublicUrl}/api/media/webhooks</c>.
/// </summary>
public sealed class MediaOptions
{
    public const string Section = "Media";

    /// <summary>
    /// Where this server reaches Foxfire Media: its public address, or one only
    /// the server can use — <c>http://foxfire-media:8080</c> on a shared Docker network.
    /// </summary>
    public string BaseUrl { get; set; } = "";

    /// <summary>
    /// Where browsers reach Foxfire Media — its own PublicBaseUrl — when that is
    /// not <see cref="BaseUrl"/>. Its player is framed from there, so it is what
    /// the web client's CSP and /version name. Empty means BaseUrl is public too.
    /// </summary>
    public string PublicUrl { get; set; } = "";

    /// <summary>This server's application key on Foxfire Media (its ApiKeys__&lt;Name&gt;). Also what its webhooks are signed with.</summary>
    public string ApiKey { get; set; } = "";

    /// <summary>
    /// How long an embed URL is good for. Only its loading has to happen inside
    /// it — the player refreshes its own playback tokens after that — so this
    /// is the time between opening a recording's page and the video loading.
    /// </summary>
    public TimeSpan EmbedLifetime { get; set; } = TimeSpan.FromHours(1);

    public bool IsEnabled => !string.IsNullOrWhiteSpace(BaseUrl) && !string.IsNullOrWhiteSpace(ApiKey);

    /// <summary>
    /// The origin browsers frame Foxfire Media's player from: <see cref="PublicUrl"/>'s,
    /// or <see cref="BaseUrl"/>'s when there is none. Null when it is not a URL.
    /// </summary>
    public string? Origin => OriginOf(string.IsNullOrWhiteSpace(PublicUrl) ? BaseUrl : PublicUrl);

    private static string? OriginOf(string value) =>
        Uri.TryCreate(value.Trim(), UriKind.Absolute, out var url) && url.Scheme is "http" or "https"
            ? url.GetLeftPart(UriPartial.Authority).ToLowerInvariant()
            : null;
}
