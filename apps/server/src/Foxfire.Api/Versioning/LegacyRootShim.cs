using Foxfire.Api.Common;

namespace Foxfire.Api.Versioning;

/// <summary>
/// Keeps desktop 0.12.0 working after the API moved under <c>/api</c>.
///
/// 0.12.0 calls every route at the root — <c>/auth/login</c>, <c>/search</c>,
/// <c>/hub</c> — and those addresses now belong to the web client: a browser
/// opening <c>/search</c> should get the search page, not a JSON error. What
/// tells the two apart is the <c>X-Foxfire-Client</c> header, which every desktop
/// sends on every request, its hub included, and which no browser sends when it
/// opens a page. So a request that carries it and is not already under
/// <c>/api</c> is moved there before routing sees it.
///
/// <c>/version</c> and <c>/health</c> are left where they are: they answer at
/// the root permanently, for every client.
///
/// This exists for as long as 0.12.0 is on the allow list, and goes when it
/// leaves — at which point every desktop the server serves already calls
/// <c>/api</c> itself.
/// </summary>
public sealed class LegacyRootShim(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;

        if (request.Headers.ContainsKey(ClientIdentity.HeaderName)
            && !ApiPaths.IsApi(request.Path)
            && !ApiPaths.IsRootMeta(request.Path))
        {
            request.Path = new PathString(ApiPaths.Base).Add(request.Path);
        }

        return next(context);
    }
}

public static class LegacyRootShimExtensions
{
    /// <summary>Must run before routing, which is what it rewrites the path for.</summary>
    public static IApplicationBuilder UseLegacyRootShim(this IApplicationBuilder app) =>
        app.UseMiddleware<LegacyRootShim>();
}
