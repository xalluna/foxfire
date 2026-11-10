using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
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

    /// <summary>The relay page a desktop frames a recording's player through. See <see cref="RelayPolicy"/>.</summary>
    public const string RelayPath = "/media-relay";

    private const string RelayFile = "media-relay.html";

    /// <summary>
    /// What a browser is allowed to load into a page from here.
    ///
    /// Data Dragon is Riot's CDN for champion and item art, read directly by the
    /// page. 'wasm-unsafe-eval' is for sql.js, which reads a stats.db in the
    /// browser for an admin importing one; it compiles WebAssembly and allows
    /// nothing else. Styles allow inline because the charts set sizes in style
    /// attributes.
    ///
    /// Foxfire Media is the one other party, for recordings, and only on a
    /// server that has it configured: its player, in a frame, and its poster
    /// images. No script of its runs in the page — the player is driven over
    /// postMessage. Everything else is this origin or nothing.
    /// </summary>
    public static string ContentSecurityPolicy(string? mediaOrigin) =>
        "default-src 'self'; "
        + "script-src 'self' 'wasm-unsafe-eval'; "
        + (mediaOrigin is null ? "" : $"frame-src {mediaOrigin}; ")
        + "style-src 'self' 'unsafe-inline'; "
        + $"img-src 'self' data: https://ddragon.leagueoflegends.com{(mediaOrigin is null ? "" : " " + mediaOrigin)}; "
        + "connect-src 'self' https://ddragon.leagueoflegends.com; "
        + "font-src 'self'; "
        + "object-src 'none'; "
        + "base-uri 'self'; "
        + "form-action 'self'; "
        + "frame-ancestors 'none'";

    /// <summary>
    /// The relay page's policy: one script of ours, a frame of Foxfire Media's,
    /// and nothing else.
    ///
    /// It is the one page here that may be framed by anybody. The desktop's
    /// window is a file:// page, which Foxfire Media's player will neither be
    /// framed by nor take commands from; this page is on this server's origin,
    /// which Foxfire Media does accept, so the desktop frames it and it frames
    /// the player and passes the commands through. It holds nothing — it plays
    /// an embed its parent hands it, only one of Foxfire Media's, and a page
    /// that framed it elsewhere would still be refused by the player's own
    /// frame-ancestors.
    /// </summary>
    public static string RelayPolicy(string? mediaOrigin) =>
        "default-src 'none'; "
        + "script-src 'self'; "
        + "style-src 'self'; "
        + (mediaOrigin is null ? "" : $"frame-src {mediaOrigin}; ")
        + "base-uri 'none'; "
        + "form-action 'none'";

    private readonly string _pagePolicy;
    private readonly string _relayPolicy;

    private SpaHosting(string? root, string? mediaOrigin)
    {
        Root = root;
        MediaOrigin = mediaOrigin;
        _pagePolicy = ContentSecurityPolicy(mediaOrigin);
        _relayPolicy = RelayPolicy(mediaOrigin);
    }

    /// <summary>Foxfire Media's origin, when this server keeps recordings there.</summary>
    public string? MediaOrigin { get; }

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

        var media = configuration.GetSection(MediaOptions.Section).Get<MediaOptions>() ?? new();
        return new SpaHosting(root, media.IsEnabled ? media.Origin : null);
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

                if (string.Equals(context.File.Name, RelayFile, StringComparison.OrdinalIgnoreCase))
                {
                    AddRelayHeaders(context.Context.Response);
                }
                else if (context.File.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
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

        // The relay, at an address without the .html, for the desktop to frame.
        // Only where there are recordings to relay.
        if (MediaOrigin is not null && File.Exists(Path.Combine(Root!, RelayFile)))
        {
            endpoints.MapMethods(RelayPath, [HttpMethods.Get, HttpMethods.Head], context =>
            {
                var response = context.Response;
                response.ContentType = "text/html; charset=utf-8";
                response.Headers[HeaderNames.CacheControl] = "no-cache";
                response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
                AddRelayHeaders(response);

                return HttpMethods.IsHead(context.Request.Method)
                    ? Task.CompletedTask
                    : response.SendFileAsync(Path.Combine(Root!, RelayFile), context.RequestAborted);
            });
        }

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
    private void AddPageHeaders(HttpResponse response)
    {
        response.Headers[HeaderNames.ContentSecurityPolicy] = _pagePolicy;
        response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        response.Headers["Referrer-Policy"] = "same-origin";
    }

    /// <summary>
    /// The relay's: framable (no frame-ancestors, unlike every other page here)
    /// and not indexed.
    /// </summary>
    private void AddRelayHeaders(HttpResponse response)
    {
        response.Headers[HeaderNames.ContentSecurityPolicy] = _relayPolicy;
        response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        response.Headers["Referrer-Policy"] = "same-origin";
    }
}
