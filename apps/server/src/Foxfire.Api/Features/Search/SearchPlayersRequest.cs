using Foxfire.Api.Common;
using Foxfire.Api.Features.Reads;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Search;

/// <summary>
/// One tracked player, as the finder lists them.
///
/// Composed rather than flattened: the account half is the same
/// <see cref="RiotAccountResponse"/> every other screen is handed, so there is
/// one definition of what IsMine means and one shape for the row to draw. The
/// rank beside it is solo queue only — a list is scanned, not studied, and two
/// ladders per row is more than a name needs to carry.
/// </summary>
/// <param name="SoloEntry">Null for an account that has never been placed, or never synced.</param>
public sealed record PlayerSearchResponse(
    RiotAccountResponse Account,
    LeagueEntryResponse? SoloEntry);

/// <summary>
/// Finding somebody this server already tracks.
///
/// Reads the database and nothing else. Search used to be a live Riot lookup of
/// any Riot ID in the world — fourteen requests out of a budget the whole
/// community shares, answering with games that could carry no LP because
/// nothing about that player was stored. What people actually want from a
/// search here is the history this server already keeps, which is the one thing
/// that lookup could never return.
///
/// A blank query is the whole list, deliberately. The finder opens with
/// everybody on it, and an empty box should show what you would see before you
/// typed. Uncapped for the same reason ListRiotAccountsRequest is: a server
/// tracks the people who play on it, and that is a number you can scroll.
/// </summary>
public sealed record SearchPlayersRequest(string? Q) : IDomainRequest<IReadOnlyList<PlayerSearchResponse>>;

internal sealed class SearchPlayersRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<SearchPlayersRequest, IReadOnlyList<PlayerSearchResponse>>
{
    public async Task<Response<IReadOnlyList<PlayerSearchResponse>>> Handle(
        SearchPlayersRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var needle = (request.Q ?? "").Trim().ToLowerInvariant();

        var accounts = db.RiotAccounts.Include(a => a.Owner).AsQueryable();

        if (needle.Length > 0)
        {
            // Name, tag, or the whole Riot ID — somebody pasting "Faker#KR1"
            // out of a lobby should find the same row as somebody typing
            // "faker". Lowered on both sides rather than trusting the column's
            // collation to be case-insensitive.
            accounts = accounts.Where(a =>
                a.GameName.ToLower().Contains(needle)
                || a.TagLine.ToLower().Contains(needle)
                || (a.GameName + "#" + a.TagLine).ToLower().Contains(needle));
        }

        var found = await accounts.OrderBy(a => a.GameName).ToListAsync(cancellationToken);

        // Fetched separately rather than as a join, because the rows are keyed
        // by (account, queue) and only one queue is wanted: a second small
        // query is easier to read than a grouped left join, and the set it runs
        // against is whatever the search already narrowed to.
        var solo = RankedQueue.SoloDuo.RiotName();
        var ids = found.ConvertAll(a => a.Id);

        var entries = await db.LeagueEntries
            .Where(e => ids.Contains(e.RiotAccountId) && e.QueueType == solo)
            .ToDictionaryAsync(e => e.RiotAccountId, cancellationToken);

        return Response<IReadOnlyList<PlayerSearchResponse>>.Success(
        [
            .. found.Select(a => new PlayerSearchResponse(
                RiotAccountResponse.Describe(a, me.UserId),
                entries.TryGetValue(a.Id, out var entry) ? LeagueEntryResponse.Describe(entry) : null))
        ]);
    }
}
