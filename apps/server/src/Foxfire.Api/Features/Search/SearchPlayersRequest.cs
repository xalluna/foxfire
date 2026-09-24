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
/// A blank query is everybody, a page at a time — never all of them at once:
/// this used to be uncapped on the grounds that a server tracks the people who
/// play on it and that is a number you can scroll, and a community is not
/// obliged to stay a size that makes that true. Pages run in name order, which
/// the unique index on (GameName, TagLine) already holds, so a blank query reads
/// one page of an index rather than sorting the table.
///
/// A typed one is closest first, because a search box shows the first ten: an
/// exact name or whole Riot ID, then names that start with what was typed, then
/// names that only contain it, alphabetical within each. The clients' own copy
/// of the rule is <c>compareSearchResults</c> in @foxfire/core.
///
/// Two filters narrow it for the screens that need less than everybody: Mine
/// for the caller's own accounts, which a finder shows first, and Claimed for
/// the ones somebody has linked, which is the admin's list of claims to undo.
/// </summary>
/// <param name="Limit">At most <see cref="MaxLimit"/>; <see cref="DefaultLimit"/> when left out.</param>
public sealed record SearchPlayersRequest(
    string? Q,
    bool Mine = false,
    bool Claimed = false,
    int? Limit = null,
    int? Offset = null) : IDomainRequest<Page<PlayerSearchResponse>>
{
    /// <summary>A page, when the caller does not say.</summary>
    public const int DefaultLimit = PageRequest.DefaultLimit;

    /// <summary>The most one request is answered with, whatever it asks for.</summary>
    public const int MaxLimit = PageRequest.MaxLimit;
}

internal sealed class SearchPlayersRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IDomainRequestHandler<SearchPlayersRequest, Page<PlayerSearchResponse>>
{
    public async Task<Response<Page<PlayerSearchResponse>>> Handle(
        SearchPlayersRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var needle = (request.Q ?? "").Trim().ToLowerInvariant();
        var page = PageRequest.Of(request.Limit, request.Offset);

        var accounts = db.RiotAccounts.Include(a => a.Owner).AsQueryable();

        if (request.Mine)
        {
            // Nobody signed in has nothing of their own; compared as a null,
            // OwnerId would match every unclaimed account instead.
            if (me.UserId is not { } userId) return Response<Page<PlayerSearchResponse>>.Success(Page<PlayerSearchResponse>.Empty);
            accounts = accounts.Where(a => a.OwnerId == userId);
        }

        if (request.Claimed) accounts = accounts.Where(a => a.OwnerId != null);

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

        // "ali" should find Ali#NA1 before a page of Aalinas: somebody typing
        // into a box that shows ten wants the closest ten, not the first ten A
        // to Z. Blank has nothing to be close to, and keeps the plain name
        // order the index already holds.
        var ordered = needle.Length == 0
            ? accounts.OrderBy(a => a.GameName)
            : accounts
                .OrderBy(a =>
                    a.GameName.ToLower() == needle || (a.GameName + "#" + a.TagLine).ToLower() == needle ? 0
                    : a.GameName.ToLower().StartsWith(needle) ? 1
                    : 2)
                .ThenBy(a => a.GameName);

        // The tag and then the id break ties, so a page boundary cannot fall
        // between two rows the database would order differently next time.
        var found = await ordered
            .ThenBy(a => a.TagLine)
            .ThenBy(a => a.Id)
            .ToPageAsync(page, cancellationToken);

        // Fetched separately rather than as a join, because the rows are keyed
        // by (account, queue) and only one queue is wanted: a second small
        // query is easier to read than a grouped left join, and the set it runs
        // against is whatever the search already narrowed to.
        var solo = RankedQueue.SoloDuo.RiotName();
        var ids = found.Items.Select(a => a.Id).ToList();

        var entries = await db.LeagueEntries
            .Where(e => ids.Contains(e.RiotAccountId) && e.QueueType == solo)
            .ToDictionaryAsync(e => e.RiotAccountId, cancellationToken);

        return Response<Page<PlayerSearchResponse>>.Success(
            found.Map(a => new PlayerSearchResponse(
                RiotAccountResponse.Describe(a, me.UserId),
                entries.TryGetValue(a.Id, out var entry) ? LeagueEntryResponse.Describe(entry) : null)));
    }
}
