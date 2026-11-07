using FluentValidation;
using Foxfire.Api.Configuration;
using Foxfire.Core;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Common;

/// <summary>
/// A game named by a request, which may name none.
///
/// Every route that was League's before there were two games takes an optional
/// <c>game</c> rather than moving, so a desktop from before TFT keeps working
/// against this server: it names no game, and no game means League. A route
/// that is only ever one game's lives under that game's path instead.
/// </summary>
internal static class GameParam
{
    /// <summary>The game a request names, League when it names none.</summary>
    public static Game Parse(string? slug) => Games.FromSlug(slug ?? "lol") ?? Game.Lol;

    /// <summary>Whether a request names a game Foxfire knows, or none at all.</summary>
    public static bool IsValid(string? slug) => slug is null || Games.FromSlug(slug) is not null;

    /// <summary>
    /// Refuses a game this server does not offer rather than reading it as
    /// League — one nobody has heard of, or TFT on a server with it off.
    /// </summary>
    public static IRuleBuilderOptions<T, string?> MustNameAGame<T>(
        this IRuleBuilder<T, string?> rule,
        ServerGames games) =>
        rule.Must(slug => games.Offers(slug))
            .WithErrorCode("unknown_game")
            .WithMessage("That is not a game this server tracks.");
}

/// <summary>
/// The games this server offers, settled when it starts.
///
/// League always. TFT only when the host has set <c>Tft__Enabled</c>: it needs
/// a Riot key registered for TFT, and a personal key is registered for one
/// product. Off, TFT is not a game this server tracks in any way a client can
/// see. <c>/version</c> lists League alone, the routes under <c>/tft</c> are
/// not mapped, and a request that names TFT is refused like one naming a game
/// nobody has heard of. Nothing asks Riot about TFT either: no probe at boot,
/// no sync, no post-game ladder, no background sweep. What was stored while it
/// was on stays in the database, unread, until it is turned on again.
///
/// Read through IOptions rather than from the configuration Program.cs binds
/// first, so a test host can turn it either way.
/// </summary>
public sealed class ServerGames(IOptions<TftOptions> tft)
{
    private static readonly IReadOnlyList<Game> LeagueOnly = [Game.Lol];

    /// <summary>Whether this server offers TFT.</summary>
    public bool Tft => tft.Value.Enabled;

    /// <summary>Every game this server offers, League first.</summary>
    public IReadOnlyList<Game> All => Tft ? Games.All : LeagueOnly;

    /// <summary>Whether this server offers a game.</summary>
    public bool Offers(Game game) => game != Game.Tft || Tft;

    /// <summary>Whether a request names a game this server offers, or names none, which is League.</summary>
    public bool Offers(string? slug) => GameParam.IsValid(slug) && Offers(GameParam.Parse(slug));
}
