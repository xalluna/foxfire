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
/// Admins are deliberately not special-cased. An admin spending the
/// community's Riot budget on somebody's behalf, or recording a reading for an
/// account they do not play, is not a power anyone asked for; every other admin
/// ability is about people and access rather than about other people's data.
///
/// Head admins typing LP are the one exception, and RankWritableAsync is the
/// whole of it. A figure somebody typed wrong, or never typed, sits on their
/// history until they come back to fix it; the few people trusted with the
/// import — which writes everybody's history at once — are trusted to correct
/// one game of it.
///
/// Starting a sync stopped coming through here, and that is the one deliberate
/// exception. An account an admin added has no owner to refresh it, nothing on
/// this server syncs on a timer, and the post-game ladder needs a League client
/// nobody is running for it — so owner-only meant its history froze on the day
/// it arrived. StartSyncRequest guards the Riot budget with a per-account
/// cooldown instead. Recording a rank reading and writing LP still belong to
/// the owner: those assert something about somebody's account rather than ask
/// for what Riot already published.
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

    /// <summary>
    /// The Riot account, if the caller may type or clear LP on it: its owner,
    /// or a head admin — on anybody's account, claimed or not. Null covers
    /// both refusals, as MineAsync's does.
    /// </summary>
    public async Task<RiotAccount?> RankWritableAsync(
        Guid riotAccountId,
        CancellationToken cancellationToken = default)
    {
        if (me.UserId is null) return null;
        if (!me.IsInRole(FoxfireRoles.HeadAdmin)) return await MineAsync(riotAccountId, cancellationToken);

        return await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken);
    }

    /// <summary>Whether the caller owns this account, rather than writing to it as a head admin.</summary>
    public bool Owns(RiotAccount account)
    {
        ArgumentNullException.ThrowIfNull(account);
        return me.UserId is { } userId && account.OwnerId == userId;
    }
}
