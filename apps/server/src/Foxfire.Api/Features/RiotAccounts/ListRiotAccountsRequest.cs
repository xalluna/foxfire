using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// DEPRECATED. Every League account this server tracks, in one answer. Only Desktop 0.14 asks.
///
/// This was how every client learned about accounts: the whole table, with
/// IsMine telling the caller's apart, held in memory and searched there for
/// whichever one a page named. That is a number that grows with the community
/// rather than with the person asking, and a server with a large one would hand
/// every desktop all of it on every launch. Clients from Server 0.4.0 ask for
/// what they need instead — their own accounts, one account by id or Riot ID,
/// and a page of search.
///
/// Kept, unchanged, because Desktop 0.14.0 is on the allow list and reads
/// nothing else. Marked obsolete so nothing new can call it without saying so,
/// and answered with a Deprecation header so nothing already calling it can
/// miss it. Delete this file, its route and its test in the PR that takes
/// 0.14.x off <c>DesktopCompatibility.Allowed</c>.
/// </summary>
[Obsolete(WholeServerAccountList.Message)]
public sealed record ListRiotAccountsRequest : IDomainRequest<IReadOnlyList<RiotAccountResponse>>;

[Obsolete(WholeServerAccountList.Message)]
internal sealed class ListRiotAccountsRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<ListRiotAccountsRequest, IReadOnlyList<RiotAccountResponse>>
{
    public async Task<Response<IReadOnlyList<RiotAccountResponse>>> Handle(
        ListRiotAccountsRequest request,
        CancellationToken cancellationToken)
    {
        var accounts = await db.RiotAccounts
            .Include(a => a.Owner)
            .OrderBy(a => a.GameName)
            .ToListAsync(cancellationToken);

        return Response<IReadOnlyList<RiotAccountResponse>>.Success(
            [.. accounts.Select(a => RiotAccountResponse.Describe(a, me.UserId))]);
    }
}

/// <summary>What is said about the whole-server account list, in the build and on the wire.</summary>
public static class WholeServerAccountList
{
    /// <summary>The compiler's warning, for anything that reaches for it.</summary>
    public const string Message =
        "GET /api/riot-accounts answers with every account on the server and is kept only for Desktop 0.14. "
        + "Ask for what you need instead: /riot-accounts/mine, /riot-accounts/{id}, /riot-accounts/lookup, "
        + "or a page of /search. Delete it in the PR that takes 0.14.x off DesktopCompatibility.Allowed.";

    /// <summary>When it was deprecated: Server 0.4.0.</summary>
    public static readonly DateTimeOffset DeprecatedSince = new(2026, 9, 24, 0, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// Says so on the response, in the header RFC 9745 defines for exactly this —
    /// a date, spelled as a structured-field "@" and Unix seconds. No Sunset
    /// beside it: when it goes is decided by the allow list, not by a calendar.
    /// </summary>
    public static void MarkDeprecated(HttpResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);
        response.Headers["Deprecation"] = $"@{DeprecatedSince.ToUnixTimeSeconds()}";
    }
}
