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
/// Which desktop builds this server will talk to, stated by hand.
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
}
