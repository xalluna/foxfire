using Foxfire.Api.Auth;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Features.Auth;

/// <summary>Who somebody is, as every screen that greets them reads it.</summary>
/// <param name="IsHeadAdmin">
/// An admin who may also import, type anybody's LP, and act against other
/// admins. Always an admin as well, so IsAdmin is true whenever this is.
/// </param>
/// <param name="EmailConfirmed">Whether they have shown they read mail sent to <paramref name="Email"/>.</param>
/// <param name="PendingEmail">
/// The address they asked to move to, while the link sent there waits to be
/// opened. <paramref name="Email"/> stays the login until it is.
/// </param>
public sealed record MeResponse(
    Guid Id,
    string Username,
    string Email,
    bool IsAdmin,
    bool IsHeadAdmin,
    bool EmailConfirmed,
    string? PendingEmail = null);

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
    public static SessionResponse Describe(
        TokenPair pair,
        FoxfireUser user,
        IEnumerable<string> roles,
        string? pendingEmail = null) =>
        new(pair.AccessToken,
            pair.AccessTokenExpiresAt,
            pair.RefreshToken,
            pair.RefreshTokenExpiresAt,
            new MeResponse(
                user.Id,
                user.UserName ?? "",
                user.Email ?? "",
                roles.Contains(FoxfireRoles.Admin),
                roles.Contains(FoxfireRoles.HeadAdmin),
                user.EmailConfirmed,
                pendingEmail));
}
