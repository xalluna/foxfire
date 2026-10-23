using FluentValidation;
using Foxfire.Core;

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

    /// <summary>Whether a request names a game this server tracks, or none at all.</summary>
    public static bool IsValid(string? slug) => slug is null || Games.FromSlug(slug) is not null;

    /// <summary>Refuses a game nobody has heard of rather than reading it as League.</summary>
    public static IRuleBuilderOptions<T, string?> MustNameAGame<T>(this IRuleBuilder<T, string?> rule) =>
        rule.Must(IsValid)
            .WithErrorCode("unknown_game")
            .WithMessage("That is not a game this server tracks.");
}
