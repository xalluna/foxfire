using Foxfire.Api.Common;
using Foxfire.Core;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Microsoft.Net.Http.Headers;

namespace Foxfire.Api.Web;

/// <summary>
/// The web client, served from the same origin as the API.
///
/// Same origin is the whole design: there is no CORS to configure and no proxy
/// to keep in step, and a web client can only ever talk to the server that
/// served it — which is what binds a hosted Foxfire web client to exactly one
/// server, with the server's own configuration as the only setting.
///
/// Optional. A server built without the web client — a development run of the
/// API on its own — serves the API exactly as before and says so once at
/// startup.
/// </summary>
public sealed class SpaHosting
{
    /// <summary>Configuration key naming a directory to serve from, ahead of everything else. Used by the tests.</summary>
    public const string RootSetting = "Web:Root";

    private const string IndexFile = "index.html";

    /// <summary>
    /// What a browser is allowed to load into a page from here.
    ///
    /// Data Dragon is Riot's CDN for champion and item art, read directly by the
    /// page. 'wasm-unsafe-eval' is for sql.js, which reads a stats.db in the
    /// browser for an admin importing one; it compiles WebAssembly and allows
    /// nothing else. Styles allow inline because the charts set sizes in style
    /// attributes.
    ///
    /// YouTube is the one other party, for recordings, and only in a build made
    /// with them (see Foxfire.Core/BuildFeatures.cs): its IFrame API script, which is
    /// what lets the marker strip under a recording seek the video, and the
    /// privacy-enhanced player it drives, in a frame. Nothing from YouTube is
    /// drawn in the page itself. Everything else is this origin or nothing.
    /// </summary>
    private static readonly string ContentSecurityPolicy =
        "default-src 'self'; "
        + (BuildFeatures.YouTubeRecordings
            ? "script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com; "
              + "frame-src https://www.youtube-nocookie.com; "
            : "script-src 'self' 'wasm-unsafe-eval'; ")
        + "style-src 'self' 'unsafe-inline'; "
        + "img-src 'self' data: https://ddragon.leagueoflegends.com; "
        + "connect-src 'self' https://ddragon.leagueoflegends.com; "
        + "font-src 'self'; "
        + "object-src 'none'; "
        + "base-uri 'self'; "
        + "form-action 'self'; "
        + "frame-ancestors 'none'";

    private SpaHosting(string? root) => Root = root;

    /// <summary>The directory holding the web client's build, or null when there is none.</summary>
    public string? Root { get; }

    public bool IsAvailable => Root is not null;

    private string IndexPath => Path.Combine(Root!, IndexFile);

    /// <summary>
    /// Finds the web client's build: the first of these holding an index.html.
    ///
    /// <c>Web:Root</c> first, for the tests. Then the host's web root, which is
    /// wwwroot beside the content root. Then wwwroot beside the executable,
    /// because a single-file publish resolves its content root from wherever it
    /// was launched, and a host starting it from another directory should not
    /// lose the web client over it.
    /// </summary>
    public static SpaHosting Locate(IConfiguration configuration, IWebHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        ArgumentNullException.ThrowIfNull(environment);

        string?[] candidates =
        [
            configuration[RootSetting],
            environment.WebRootPath,
            Path.Combine(AppContext.BaseDirectory, "wwwroot")
        ];

        var root = candidates.FirstOrDefault(dir =>
            !string.IsNullOrWhiteSpace(dir) && File.Exists(Path.Combine(dir, IndexFile)));

        return new SpaHosting(root);
    }

    /// <summary>
    /// Serves the build's files.
    ///
    /// Vite fingerprints everything under /assets, so a file there never
    /// changes under its name and is cached for good. Everything else —
    /// index.html above all, which names this release's assets — is
    /// revalidated on every load, so an upgrade reaches an open browser the
    /// next time it navigates rather than when a cache happens to expire.
    /// </summary>
    public void UseFiles(IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        if (!IsAvailable) return;

        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(Root!),
            ContentTypeProvider = new FileExtensionContentTypeProvider(),
            OnPrepareResponse = context =>
            {
                var headers = context.Context.Response.Headers;
                var path = context.Context.Request.Path;

                headers[HeaderNames.CacheControl] = path.StartsWithSegments("/assets")
                    ? "public, max-age=31536000, immutable"
                    : "no-cache";
                headers[HeaderNames.XContentTypeOptions] = "nosniff";

                if (context.File.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
                {
                    AddPageHeaders(context.Context.Response);
                }
            }
        });
    }

    /// <summary>
    /// Answers every other address with the web client, which routes it.
    ///
    /// Not the framework's default fallback route, which skips anything that
    /// looks like a file name — and an invite token is two base64 halves joined
    /// by a dot, so <c>/invite/{token}</c> would be taken for a missing file and
    /// every invite link would 404. Only /assets is treated as files here: an
    /// asset that is not there is a 404, not the app.
    ///
    /// API routes never get here. They have their own fallback, under /api,
    /// which answers an unknown route with a JSON 404 — a client asking for a
    /// route that does not exist should hear so, not be handed a web page.
    /// </summary>
    public void MapFallback(IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);
        if (!IsAvailable) return;

        endpoints.MapFallback("{**path}", context =>
        {
            var request = context.Request;

            if (ApiPaths.IsApi(request.Path)
                || request.Path.StartsWithSegments("/assets")
                || !(HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)))
            {
                context.Response.StatusCode = StatusCodes.Status404NotFound;
                return Task.CompletedTask;
            }

            var response = context.Response;
            response.ContentType = "text/html; charset=utf-8";
            response.Headers[HeaderNames.CacheControl] = "no-cache";
            response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
            AddPageHeaders(response);

            return HttpMethods.IsHead(request.Method)
                ? Task.CompletedTask
                : response.SendFileAsync(IndexPath, context.RequestAborted);
        });
    }

    /// <summary>
    /// What every page of the web client is sent with.
    ///
    /// Not indexed: a Foxfire server is a private community's, and a search
    /// engine listing its sign-in page helps nobody. The referrer policy keeps
    /// a page's address — an invite token, sometimes — from being sent to Data
    /// Dragon with every image the page loads.
    /// </summary>
    private static void AddPageHeaders(HttpResponse response)
    {
        response.Headers[HeaderNames.ContentSecurityPolicy] = ContentSecurityPolicy;
        response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        response.Headers["Referrer-Policy"] = "same-origin";
    }
}
