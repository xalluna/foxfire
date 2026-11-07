namespace Foxfire.Core;

/// <summary>
/// A Riot title Foxfire tracks, played on a Riot ID.
///
/// The account — its PUUID, its name, who claimed it — is shared, and
/// everything that differs between titles hangs off one of these: its ladders,
/// its matches, its seasons, its syncs, and which Riot key reaches its API.
///
/// The server's copy of packages/core/src/games/registry.ts. The two are held
/// together by fixtures/game-registry.json, which the TypeScript writes and
/// <c>GameRegistryTests</c> reads, so a game added to one and not the other
/// fails a build. Append only: the stored spelling is <see cref="Games.Slug"/>,
/// never the member's number, but a reorder still reads as a change to every
/// switch over it.
/// </summary>
public enum Game
{
    Lol,
    Tft
}

/// <summary>
/// Which Riot key a game's API is called with.
///
/// Riot ties a registered key to a product and encrypts a PUUID per key, so
/// TFT may need a key of its own — and with one, every account has a second
/// PUUID. League is always the main key.
/// </summary>
public enum RiotKeyScope
{
    Main,
    Tft
}

public static class Games
{
    /// <summary>Every game, in the order a switch offers them.</summary>
    public static readonly IReadOnlyList<Game> All = [Game.Lol, Game.Tft];

    /// <summary>The game as the wire and the database spell it: <c>lol</c>, <c>tft</c>.</summary>
    public static string Slug(this Game game) => game switch
    {
        Game.Lol => "lol",
        Game.Tft => "tft",
        _ => throw new ArgumentOutOfRangeException(nameof(game))
    };

    /// <summary>
    /// The game a slug names, or null for anything else.
    ///
    /// Exact, like the TypeScript's parseGameId: a route that takes a game
    /// refuses <c>TFT</c> rather than guessing, so a link that works here works
    /// against the desktop's own database too.
    /// </summary>
    public static Game? FromSlug(string? slug) => slug switch
    {
        "lol" => Game.Lol,
        "tft" => Game.Tft,
        _ => null
    };

    /// <summary>The folder a recording of the game is filed under on a desktop.</summary>
    public static string Folder(this Game game) => game switch
    {
        Game.Lol => "LoL",
        Game.Tft => "TFT",
        _ => throw new ArgumentOutOfRangeException(nameof(game))
    };

    /// <summary>The key a game is meant to be called with, when it has its own.</summary>
    public static RiotKeyScope KeyScope(this Game game) => game switch
    {
        Game.Lol => RiotKeyScope.Main,
        Game.Tft => RiotKeyScope.Tft,
        _ => throw new ArgumentOutOfRangeException(nameof(game))
    };

    /// <summary>The key scope as stored: <c>main</c>, <c>tft</c>.</summary>
    public static string Slug(this RiotKeyScope scope) => scope switch
    {
        RiotKeyScope.Main => "main",
        RiotKeyScope.Tft => "tft",
        _ => throw new ArgumentOutOfRangeException(nameof(scope))
    };

    /// <summary>
    /// The queue ids Foxfire names for a game, and the folder each is filed under.
    ///
    /// Only what the desktop files recordings by and the registry fixture
    /// checks; the server reads a game from its ladders and its match payload,
    /// never from this list.
    /// </summary>
    public static IReadOnlyList<(int QueueId, string Folder)> Queues(this Game game) => game switch
    {
        Game.Lol =>
        [
            (420, "Solo-Duo"), (440, "Flex"), (400, "Normal-Draft"), (430, "Normal-Blind"),
            (450, "ARAM"), (1700, "Arena"), (480, "Swiftplay"), (490, "Quickplay"),
            (700, "Clash"), (720, "ARAM-Clash"), (900, "ARURF"), (1900, "URF"), (0, "Custom")
        ],
        Game.Tft => [(1100, "Ranked"), (1160, "Double-Up"), (1130, "Hyper-Roll"), (1090, "Normal")],
        _ => throw new ArgumentOutOfRangeException(nameof(game))
    };

    /// <summary>
    /// When to look for a game the client has just said is over, from that moment.
    ///
    /// Riot publishes a match a few minutes after it ends. A TFT match only once
    /// the whole lobby is done — somebody knocked out early can be twenty
    /// minutes ahead of the last player standing — so its ladder runs longer.
    /// </summary>
    public static IReadOnlyList<TimeSpan> PostGameRetryDelays(this Game game) => game switch
    {
        Game.Lol =>
        [
            TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(90), TimeSpan.FromMinutes(3),
            TimeSpan.FromMinutes(6), TimeSpan.FromMinutes(10)
        ],
        Game.Tft =>
        [
            TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(3), TimeSpan.FromMinutes(6),
            TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(15), TimeSpan.FromMinutes(20)
        ],
        _ => throw new ArgumentOutOfRangeException(nameof(game))
    };

    /// <summary>A game's ladders, in picker order.</summary>
    public static IReadOnlyList<RankedQueue> Ladders(this Game game) => RankedQueues.Of(game);
}
