using System.Text.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Auth;
using Foxfire.Api.Versioning;

namespace Foxfire.Api.Auth;

/// <summary>
/// A session as the web client receives it: everything but the refresh token,
/// which travels as a cookie the page cannot read.
/// </summary>
public sealed record WebSessionResponse(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    DateTimeOffset RefreshTokenExpiresAt,
    MeResponse User);

/// <summary>
/// How the long-lived half of a session reaches each kind of client.
///
/// A desktop keeps its refresh token itself, encrypted with the operating
/// system's key store, and sends it in the body — that is unchanged. A browser
/// has nowhere as safe: anything a page's script can read, an injected script
/// can read too. So the web client never sees its refresh token. It arrives as
/// an httpOnly cookie, scoped to the auth routes, and goes back the same way.
/// The access token stays in the page's memory, short-lived as ever.
///
/// Only the transport differs. The handlers, the token service and its rotation
/// are the same for both, so presenting a spent refresh token still ends every
/// session its owner has, from whichever client it came.
/// </summary>
public static class SessionTransport
{
    /// <summary>The cookie a browser's refresh token lives in.</summary>
    public const string CookieName = "foxfire_refresh";

    /// <summary>
    /// Sent only to the auth routes. Nothing else needs it, and a cookie that
    /// rode along on every API call would be one more place for it to leak.
    /// </summary>
    public const string CookiePath = ApiPaths.Base + "/auth";

    /// <summary>
    /// Answers a sign-in, a registration or a refresh.
    ///
    /// A desktop gets the session as it always has. The web client gets the
    /// refresh token as a cookie and the rest in the body.
    /// </summary>
    public static IResult Deliver(HttpContext http, Response<SessionResponse> response)
    {
        ArgumentNullException.ThrowIfNull(http);
        ArgumentNullException.ThrowIfNull(response);

        if (!ClientIdentity.IsWeb(http.Request)) return response.ToResult();

        if (response.Errors.Count > 0 || response.Data is not { } session)
        {
            // A refresh that failed has ended the session; a cookie left behind
            // would only be presented again, and refused again, on every load.
            if (response.StatusCode == StatusCodes.Status401Unauthorized) Forget(http);
            return response.ToResult();
        }

        http.Response.Cookies.Append(CookieName, session.RefreshToken, Options(session.RefreshTokenExpiresAt));

        return Results.Json(
            new WebSessionResponse(session.AccessToken, session.AccessTokenExpiresAt, session.RefreshTokenExpiresAt, session.User),
            statusCode: response.StatusCode);
    }

    /// <summary>
    /// The refresh token a request presents: the cookie from the web client, the
    /// body from a desktop. Never the other way round — a desktop has no cookie,
    /// and a page has no token to put in a body.
    ///
    /// The body is read here rather than bound with [FromBody], because the web
    /// client posts no body at all. A [FromBody] parameter, even an optional
    /// one, tells routing the endpoint only accepts JSON, and routing turns away
    /// a request with no Content-Type before any handler runs. Under /api that
    /// surfaces as the fallback's 404, which says nothing about why.
    /// </summary>
    public static async Task<string> RefreshTokenFromAsync(HttpContext http, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(http);

        if (ClientIdentity.IsWeb(http.Request)) return http.Request.Cookies[CookieName] ?? "";
        if (!http.Request.HasJsonContentType()) return "";

        try
        {
            var body = await http.Request.ReadFromJsonAsync<RefreshTokenBody>(cancellationToken);
            return body?.RefreshToken ?? "";
        }
        catch (JsonException)
        {
            // A body with no readable token in it presents no token, which the
            // handlers refuse the way they refuse any token they do not know.
            return "";
        }
    }

    /// <summary>What a desktop posts to refresh or to sign out.</summary>
    private sealed record RefreshTokenBody(string? RefreshToken);

    /// <summary>Drops the web client's cookie, on signing out or a session that has ended.</summary>
    public static void Forget(HttpContext http)
    {
        ArgumentNullException.ThrowIfNull(http);
        if (ClientIdentity.IsWeb(http.Request)) http.Response.Cookies.Delete(CookieName, Options(expires: null));
    }

    /// <summary>
    /// Secure, so it never travels over plain HTTP; httpOnly, so no script
    /// reads it; SameSite=Strict, so no other site's page can make a browser
    /// present it. The web client is same-origin with this server, which is
    /// the one arrangement in which Strict costs nothing.
    /// </summary>
    private static CookieOptions Options(DateTimeOffset? expires) => new()
    {
        Path = CookiePath,
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Strict,
        Expires = expires,
        IsEssential = true
    };
}
