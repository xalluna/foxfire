using Foxfire.Api.Versioning;
using Microsoft.AspNetCore.Http.Features;

namespace Foxfire.Api.Telemetry;

/// <summary>
/// What Foxfire adds to ASP.NET Core's own measurement of every request.
///
/// ASP.NET already times each request and tags it with its route, method and
/// status. The one thing it cannot know is which of Foxfire's clients asked —
/// and that is what says whether a slow evening is the desktops or the browser.
/// The kind only: a desktop's version is a header anybody can write anything in,
/// and would make a new series of every typo.
/// </summary>
public static class RequestMetricTags
{
    public const string Client = "foxfire.client";

    /// <summary>
    /// Tags the request. First in the pipeline, so the requests turned away
    /// before routing — a refused desktop, a rate limit, a static file — are
    /// tagged too. The feature is only there while something is listening.
    /// </summary>
    public static void Tag(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        if (context.Features.Get<IHttpMetricsTagsFeature>() is not { } metrics) return;

        var kind = ClientIdentity.Read(context.Request) switch
        {
            ClientIdentity.Desktop => "desktop",
            ClientIdentity.Web => "web",
            _ => "unnamed"
        };

        metrics.Tags.Add(new KeyValuePair<string, object?>(Client, kind));
    }
}
