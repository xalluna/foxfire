using System.Globalization;
using System.Text.RegularExpressions;
using Foxfire.Core;

namespace Foxfire.Core.Tests;

public class DesktopAllowListTests
{
    private static readonly DesktopAllowList Three = new(["0.12.0", "0.14.1", "0.13.0"]);

    [Fact]
    public void Newest_on_the_list_is_current()
    {
        Assert.Equal(DesktopSupportLevel.Current, Three.Check("0.14.1").Level);
    }

    [Theory]
    [InlineData("0.12.0")]
    [InlineData("0.13.0")]
    public void Older_but_listed_still_gets_service(string version)
    {
        // The grace window. These work; the desktop shows a nudge.
        Assert.Equal(DesktopSupportLevel.Supported, Three.Check(version).Level);
    }

    [Theory]
    [InlineData("0.11.0")] // before the minimum
    [InlineData("0.13.5")] // between two listed versions, which is not the same as listed
    [InlineData("9.9.9")]  // after the newest — a desktop from the future is still untested
    public void Anything_not_on_the_list_is_refused(string version)
    {
        Assert.Equal(DesktopSupportLevel.Refused, Three.Check(version).Level);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("nonsense")]
    [InlineData("0.12")]        // parses, but as 0.12 — not a version we list
    [InlineData("v0.12.0")]     // the tag, not the version
    [InlineData("0.12.0-beta")] // pre-release suffixes are not a thing here
    public void Anything_unparseable_is_refused_rather_than_waved_through(string? version)
    {
        Assert.Equal(DesktopSupportLevel.Refused, Three.Check(version).Level);
    }

    [Fact]
    public void Bounds_come_from_comparing_versions_not_from_list_order()
    {
        // Constructed out of order on purpose: "0.14.1" is last in the list and
        // must still be recommended, "0.12.0" is first and must be the minimum.
        Assert.Equal("0.12.0", Three.Minimum);
        Assert.Equal("0.14.1", Three.Recommended);
    }

    [Fact]
    public void Bounds_are_reported_even_when_refusing()
    {
        // The desktop needs these to say "this server needs Foxfire 0.14.1 or
        // newer" rather than failing with nothing useful on screen.
        var verdict = Three.Check("0.1.0");

        Assert.Equal(DesktopSupportLevel.Refused, verdict.Level);
        Assert.Equal("0.12.0", verdict.Minimum);
        Assert.Equal("0.14.1", verdict.Recommended);
    }

    [Fact]
    public void A_single_allowed_version_is_both_bounds_and_is_current()
    {
        var one = new DesktopAllowList(["0.12.0"]);

        Assert.Equal("0.12.0", one.Minimum);
        Assert.Equal("0.12.0", one.Recommended);
        Assert.Equal(DesktopSupportLevel.Current, one.Check("0.12.0").Level);
    }

    [Fact]
    public void Duplicates_collapse()
    {
        var dupes = new DesktopAllowList(["0.12.0", "0.12.0", "0.13.0"]);

        Assert.Equal("0.12.0", dupes.Minimum);
        Assert.Equal("0.13.0", dupes.Recommended);
    }

    [Fact]
    public void An_empty_list_is_a_programming_error()
    {
        Assert.Throws<ArgumentException>(() => new DesktopAllowList([]));
    }
}

public class DesktopCompatibilityTests
{
    [Fact]
    public void The_compiled_in_list_accepts_its_own_newest_build()
    {
        var verdict = DesktopCompatibility.AllowList.Check(DesktopCompatibility.AllowList.Recommended);

        Assert.Equal(DesktopSupportLevel.Current, verdict.Level);
    }

    [Fact]
    public void Every_listed_version_parses()
    {
        // Guards the one way this list goes wrong in practice: a typo in a
        // hand-edited string, which would otherwise throw at class-load time
        // and take the whole server down on boot rather than failing here.
        foreach (var version in DesktopCompatibility.Allowed)
        {
            Assert.True(Version.TryParse(version, out _), $"'{version}' is not a version");
        }
    }

    [Fact]
    public void Every_listed_version_is_actually_accepted()
    {
        foreach (var version in DesktopCompatibility.Allowed)
        {
            Assert.NotEqual(DesktopSupportLevel.Refused, DesktopCompatibility.AllowList.Check(version).Level);
        }
    }

    [Fact]
    public void A_web_page_is_served_only_for_an_api_version_on_the_list()
    {
        foreach (var version in DesktopCompatibility.WebApiVersions)
        {
            Assert.True(DesktopCompatibility.ServesWebApiVersion(version));
        }

        Assert.False(DesktopCompatibility.ServesWebApiVersion(0));
        Assert.False(DesktopCompatibility.ServesWebApiVersion(DesktopCompatibility.WebApiVersions.Max() + 1));
    }
}

/// <summary>
/// The web client's API version, held to the server's list.
///
/// The web client ships inside this server, built from packages/core in the
/// same commit — so the two can only disagree if somebody bumps one side and
/// not the other. That mistake would not show up in either half's own tests:
/// the page would build, the server would start, and every call the page made
/// would be refused with "reload the page". So it is caught here, by reading
/// the constant out of the TypeScript, the same way the ladder corpus holds
/// the two ladders together.
/// </summary>
public partial class WebApiVersionTests
{
    [GeneratedRegex(@"export const WEB_API_VERSION = (\d+)")]
    private static partial Regex WebApiVersionLine();

    [Fact]
    public void The_web_client_is_built_against_a_version_this_server_serves()
    {
        var source = File.ReadAllText(FindCoreIdentitySource());
        var match = WebApiVersionLine().Match(source);

        Assert.True(match.Success, "WEB_API_VERSION was not found in packages/core/src/server/identity.ts.");

        var webApiVersion = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        Assert.Contains(webApiVersion, DesktopCompatibility.WebApiVersions);
    }

    private static string FindCoreIdentitySource()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "packages", "core", "src", "server", "identity.ts");
            if (File.Exists(candidate)) return candidate;
        }

        throw new FileNotFoundException(
            "packages/core/src/server/identity.ts was not found above " + AppContext.BaseDirectory);
    }
}
