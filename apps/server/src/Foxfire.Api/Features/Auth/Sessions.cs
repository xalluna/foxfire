using Foxfire.Api.Auth;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.Auth;

/// <summary>Who somebody is, as every screen that greets them reads it.</summary>
public sealed record MeResponse(Guid Id, string Username, string Email, bool IsAdmin, bool EmailConfirmed);

/// <summary>A signed-in session, and the two tokens that keep it.</summary>
public sealed record SessionResponse(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt,
    MeResponse User);

/// <summary>
/// Turning a freshly minted token pair into the answer three routes share.
///
/// Registering, signing in and refreshing all end the same way, and the shape
/// they end with is read by the desktop's connect screen — so it is built in
/// one place rather than three.
/// </summary>
internal static class Sessions
{
    public static SessionResponse Describe(TokenPair pair, FoxfireUser user, IEnumerable<string> roles) =>
        new(pair.AccessToken,
            pair.AccessTokenExpiresAt,
            pair.RefreshToken,
            pair.RefreshTokenExpiresAt,
            new MeResponse(
                user.Id,
                user.UserName ?? "",
                user.Email ?? "",
                roles.Contains(FoxfireRoles.Admin),
                user.EmailConfirmed));
}
