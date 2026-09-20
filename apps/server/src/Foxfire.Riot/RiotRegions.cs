namespace Foxfire.Riot;

/// <summary>
/// Riot's two routing schemes, as a table.
///
/// Platform routing serves per-server data — summoner, league, spectator.
/// Regional routing serves what is the same account-wide: the account lookup and
/// match history. A call sent to the wrong one gets a 404 that looks exactly
/// like "no such player", which is why the pairing lives in one table rather
/// than being remembered at each call site.
///
/// Ported from the desktop's src/main/riot/regions.ts. As there, the table is
/// complete and the app is not: everything defaults to NA. A community outside
/// the Americas cannot usefully host this yet, which is a known limitation
/// rather than an oversight — the columns are on RiotAccount and the routing is
/// here, so lifting the default is a change in the callers and not a rewrite.
/// </summary>
public static class RiotRegions
{
    /// <summary>Platform id to the wider route that serves account-wide data.</summary>
    public static readonly IReadOnlyDictionary<string, string> PlatformToRegional =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["na1"] = "americas",
            ["br1"] = "americas",
            ["la1"] = "americas",
            ["la2"] = "americas",
            ["euw1"] = "europe",
            ["eun1"] = "europe",
            ["tr1"] = "europe",
            ["ru"] = "europe",
            ["kr"] = "asia",
            ["jp1"] = "asia",
            ["oc1"] = "sea"
        };

    /// <summary>The only platform anything actually uses today.</summary>
    public const string DefaultPlatform = "na1";

    /// <summary>The route <see cref="DefaultPlatform"/> belongs to.</summary>
    public static string DefaultRegionalRoute => PlatformToRegional[DefaultPlatform];

    public static bool IsKnownPlatform(string? platform) =>
        platform is not null && PlatformToRegional.ContainsKey(platform);

    /// <summary>The route for a platform, or the default when it is not one Riot serves.</summary>
    public static string RegionalRouteFor(string? platform) =>
        platform is not null && PlatformToRegional.TryGetValue(platform, out var route)
            ? route
            : DefaultRegionalRoute;

    public static Uri PlatformBaseUrl(string platform) =>
        new($"https://{platform.ToLowerInvariant()}.api.riotgames.com");

    public static Uri RegionalBaseUrl(string regionalRoute) =>
        new($"https://{regionalRoute.ToLowerInvariant()}.api.riotgames.com");
}
