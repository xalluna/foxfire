using Foxfire.Api.Configuration;
using Foxfire.Api.Features.ShareLinks;
using Foxfire.Data;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Auth;

/// <summary>The account a share link opens, as much of it as the coverage checks need.</summary>
public sealed record SharedAccount(Guid ShareLinkId, Guid RiotAccountId, string GameName, string TagLine, string Puuid);

/// <summary>
/// The share link a request carries, if it carries one that still works.
///
/// It travels in a header rather than the URL of each request, so it is never
/// written into a request line, a browser's history or a referrer; the link a
/// person is handed carries it in its query string once, and the web client
/// moves it into the header and takes it off the address.
///
/// Scoped, and resolved at most once per request: the reader policy may ask
/// for it on any route, and a page of a profile is several of those.
/// </summary>
public sealed class ShareAccess(
    FoxfireDbContext db,
    IHttpContextAccessor http,
    IOptions<AuthOptions> auth,
    TimeProvider time,
    ILogger<ShareAccess> logger)
{
    /// <summary>The header a share link's token travels in.</summary>
    public const string Header = "X-Foxfire-Share";

    /// <summary>
    /// Where the request keeps the id of the link it was let in on, so its
    /// request line can say which — never the token, which is the credential.
    /// </summary>
    public const string ItemKey = "foxfire:share-link";

    /// <summary>Where it keeps why the link it carried opens nothing, for the refusal to say.</summary>
    public const string RefusalKey = "foxfire:share-link-refusal";

    private Task<SharedAccount?>? current;

    /// <summary>The account this request's share link opens, or null when it has none that works.</summary>
    public Task<SharedAccount?> CurrentAsync(CancellationToken cancellationToken) =>
        current ??= ResolveAsync(cancellationToken);

    private async Task<SharedAccount?> ResolveAsync(CancellationToken cancellationToken)
    {
        var context = http.HttpContext;
        var token = context?.Request.Headers[Header].ToString();
        if (context is null || string.IsNullOrEmpty(token)) return null;

        var (link, refusal) = await ShareLinkLookup.ResolveAsync(token, db, auth.Value, time, cancellationToken);

        if (link?.RiotAccount is not { } account)
        {
            refusal ??= ShareRefusal.Invalid;
            context.Items[RefusalKey] = refusal;
            logger.LogDebug("Refused a share link: {Reason}", refusal.Reason);
            return null;
        }

        context.Items[ItemKey] = link.Id;
        return new SharedAccount(link.Id, account.Id, account.GameName, account.TagLine, account.Puuid);
    }
}
