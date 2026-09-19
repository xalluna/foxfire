using System.Net;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Common;

/// <summary>
/// Whether the Riot account a handler is about belongs to whoever is asking.
///
/// Reads never come through here: everything on a Foxfire server is readable by
/// every member, so a read has nothing to check beyond being signed in. Writes
/// do, and they all check the same thing.
///
/// Admins are deliberately not special-cased. An admin typing somebody else's
/// LP or spending the community's Riot budget on their behalf is not a power
/// anyone asked for; every other admin ability is about people and access
/// rather than about other people's data.
///
/// The service form of what used to be a static helper taking a ClaimsPrincipal.
/// A handler has no principal, so it takes the identity context instead.
/// </summary>
public sealed class AccountOwnership(FoxfireDbContext db, IIdentityContext me)
{
    /// <summary>
    /// One answer for "not yours" and "no such account", deliberately.
    ///
    /// Splitting them would let anybody enumerate which accounts exist on a
    /// server by watching which id returns which code, and the caller can do
    /// nothing differently with the distinction anyway.
    /// </summary>
    public static Error NotYours { get; } =
        new("not_your_account", "That League account is not linked to your Foxfire account.");

    public const HttpStatusCode NotYoursStatus = HttpStatusCode.Forbidden;

    /// <summary>The Riot account, if the caller owns it. Null covers both refusals.</summary>
    public async Task<RiotAccount?> MineAsync(Guid riotAccountId, CancellationToken cancellationToken = default)
    {
        if (me.UserId is not { } userId) return null;

        return await db.RiotAccounts
            .FirstOrDefaultAsync(a => a.Id == riotAccountId && a.OwnerId == userId, cancellationToken);
    }
}
