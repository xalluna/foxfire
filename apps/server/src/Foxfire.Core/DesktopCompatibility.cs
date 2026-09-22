namespace Foxfire.Core;

/// <summary>How a server feels about the desktop build that just called it.</summary>
public enum DesktopSupportLevel
{
    /// <summary>On the list, and the newest build this server knows about.</summary>
    Current,

    /// <summary>
    /// On the list but behind. Everything works; the desktop shows a nudge.
    /// This is the grace window — without it, a host upgrading their server cuts
    /// off every friend at the same instant, and there is no auto-update to
    /// soften the landing.
    /// </summary>
    Supported,

    /// <summary>Not on the list. No service.</summary>
    Refused
}

/// <summary>What the server decided, and what to say about it.</summary>
/// <param name="Level">The verdict.</param>
/// <param name="Minimum">Oldest desktop this server will talk to.</param>
/// <param name="Recommended">Newest desktop this server knows about.</param>
public sealed record DesktopSupport(DesktopSupportLevel Level, string Minimum, string Recommended);

/// <summary>
/// A set of desktop versions, and the judgement of whether a given one is in it.
///
/// Order in is not order out: minimum and recommended come from comparing parsed
/// versions, so adding a build to a list is a one-line change that cannot be got
/// subtly wrong by putting it in the wrong place.
/// </summary>
public sealed class DesktopAllowList
{
    private readonly Version[] _allowed;

    /// <param name="versions">Dotted versions, in any order. At least one.</param>
    public DesktopAllowList(IEnumerable<string> versions)
    {
        ArgumentNullException.ThrowIfNull(versions);

        _allowed = [.. versions.Select(Version.Parse).Distinct().OrderBy(v => v)];
        if (_allowed.Length == 0)
        {
            throw new ArgumentException("A server must accept at least one desktop version.", nameof(versions));
        }

        Minimum = _allowed[0].ToString();
        Recommended = _allowed[^1].ToString();
    }

    /// <summary>Oldest build on the list.</summary>
    public string Minimum { get; }

    /// <summary>Newest build on the list — what a fresh install should be.</summary>
    public string Recommended { get; }

    /// <summary>
    /// Judges a desktop version string.
    ///
    /// Anything unparseable is refused rather than waved through. A build that
    /// cannot say what it is has no business being trusted with an account, and
    /// in practice an absent or malformed version means something other than
    /// Foxfire is calling.
    /// </summary>
    public DesktopSupport Check(string? desktopVersion)
    {
        if (!Version.TryParse(desktopVersion, out var version) || !_allowed.Contains(version))
        {
            return new DesktopSupport(DesktopSupportLevel.Refused, Minimum, Recommended);
        }

        var level = version == _allowed[^1] ? DesktopSupportLevel.Current : DesktopSupportLevel.Supported;
        return new DesktopSupport(level, Minimum, Recommended);
    }
}

/// <summary>
/// Which clients this server will talk to, stated by hand.
///
/// This is compiled in rather than configured, and that is the point. A server
/// and a desktop agree on a contract, and whether a given build honours it is a
/// fact about the code, not a preference a host should be able to get wrong.
/// Letting an operator add an untested version to a config file only moves the
/// failure from a clear refusal at connect time to something strange happening
/// three screens in, on somebody else's machine.
///
/// So the rule when changing the desktop is: add its version here, in the same
/// change. If the contract itself moved — a field dropped, a route renamed,
/// anything an older build would mis-read — bump <see cref="ApiVersion"/> and
/// remove the builds that cannot speak it.
///
/// The web client is judged differently, by the API version it was built
/// against rather than by its own version — see <see cref="WebApiVersions"/>.
/// </summary>
public static class DesktopCompatibility
{
    /// <summary>
    /// The contract version, bumped only when something breaks compatibility.
    ///
    /// Deliberately not the server's release version. The server will ship
    /// patches and features that change nothing a desktop can observe, and
    /// nobody should be told to update for those.
    /// </summary>
    public const int ApiVersion = 1;

    /// <summary>Every desktop version this server answers, in any order.</summary>
    public static readonly IReadOnlyList<string> Allowed = ["0.12.0"];

    /// <summary>The compiled-in list, ready to judge against.</summary>
    public static DesktopAllowList AllowList { get; } = new(Allowed);

    /// <summary>
    /// The API versions a web client may have been built against.
    ///
    /// Not a list of web builds. The web client ships inside this server — the
    /// page a browser holds came from here — so which build it is has never
    /// been in doubt. What goes stale is a tab left open across an upgrade:
    /// still running the old page, now talking to a new server. The page says
    /// which contract it was built for, and a tab built for one no longer
    /// listed here is told to reload rather than left to misread the answers.
    ///
    /// packages/core states the web client's side as WEB_API_VERSION, and a
    /// test holds the two together.
    /// </summary>
    public static readonly IReadOnlyList<int> WebApiVersions = [1];

    /// <summary>Whether a web page built against this API version is served.</summary>
    public static bool ServesWebApiVersion(int apiVersion) => WebApiVersions.Contains(apiVersion);
}
