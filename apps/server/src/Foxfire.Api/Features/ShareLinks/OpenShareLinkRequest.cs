using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Data;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Features.ShareLinks;

/// <summary>What somebody following a share link is told about it.</summary>
/// <param name="Usable">Whether it opens anything.</param>
/// <param name="Message">Why not, when it does not — for a person to read.</param>
/// <param name="RiotAccountId">The account it opens. Null unless usable.</param>
/// <param name="GameName">Whose profile it is. Null unless usable.</param>
/// <param name="TagLine">Null unless usable.</param>
/// <param name="ExpiresAt">Until when. Null unless usable.</param>
/// <param name="Reason">"expired", "withdrawn" or "invalid" when not usable; null when it is.</param>
public sealed record ShareLinkOpenResponse(
    bool Usable,
    string Message,
    Guid? RiotAccountId,
    string? GameName,
    string? TagLine,
    DateTimeOffset? ExpiresAt,
    string? Reason = null);

/// <summary>
/// Checks a share link before a page is built around it.
///
/// Unauthenticated, like an invite's preview, and for the same reason: whoever
/// is following one is not a member. The token comes in the body rather than
/// the path, so it never reaches a request line. Rate limited like the other
/// token routes, though there is nothing here to guess: the signature is over
/// the row id, and a row id is not a thing anybody can enumerate.
/// </summary>
public sealed record OpenShareLinkRequest(string? Token) : IDomainRequest<ShareLinkOpenResponse>;

internal sealed class OpenShareLinkRequestHandler(
    FoxfireDbContext db,
    IOptions<AuthOptions> auth,
    TimeProvider time)
    : IDomainRequestHandler<OpenShareLinkRequest, ShareLinkOpenResponse>
{
    public async Task<Response<ShareLinkOpenResponse>> Handle(
        OpenShareLinkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var (link, refusal) = await ShareLinkLookup.ResolveAsync(
            request.Token ?? "", db, auth.Value, time, cancellationToken);

        return link?.RiotAccount is { } account
            ? new ShareLinkOpenResponse(true, "Ready to use.", account.Id, account.GameName, account.TagLine, link.ExpiresAt)
            : new ShareLinkOpenResponse(
                false, (refusal ?? ShareRefusal.Invalid).Message, null, null, null, null, (refusal ?? ShareRefusal.Invalid).Reason);
    }
}
