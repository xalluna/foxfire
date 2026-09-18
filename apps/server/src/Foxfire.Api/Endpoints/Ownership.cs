using System.Security.Claims;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>
/// Who is asking, and whether this is theirs.
///
/// Reads never come through here: everything on a Foxfire server is readable by
/// every member, so a read has nothing to check beyond being signed in. Writes
/// do, and they all check the same thing — that the caller has claimed the Riot
/// account they are writing against.
///
/// Admins are deliberately not special-cased. An admin typing somebody else's LP
/// or spending the community's Riot budget on their behalf is not a power anyone
/// asked for; every other admin ability is about people and access rather than
/// about other people's data.
/// </summary>
public static class Ownership
{
    /// <summary>The Foxfire account making the request, or null if the token has no id.</summary>
    public static Guid? UserId(ClaimsPrincipal principal)
    {
        ArgumentNullException.ThrowIfNull(principal);
        return Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;
    }

    /// <summary>The Riot account, if the caller owns it. Null covers both "not yours" and "no such thing".</summary>
    public static async Task<RiotAccount?> MineAsync(
        FoxfireDbContext db,
        ClaimsPrincipal principal,
        Guid riotAccountId,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(db);

        var me = UserId(principal);
        if (me is null) return null;

        return await db.RiotAccounts
            .FirstOrDefaultAsync(a => a.Id == riotAccountId && a.OwnerId == me, cancellationToken);
    }

    /// <summary>
    /// One answer for "not yours" and "no such account", deliberately.
    ///
    /// Splitting them would let anybody enumerate which accounts exist on a
    /// server by watching which id returns which code, and the caller can do
    /// nothing differently with the distinction anyway.
    /// </summary>
    public static IResult NotYours() =>
        AuthEndpoints.Problem(
            "not_your_account",
            "That League account is not linked to your Foxfire account.",
            StatusCodes.Status403Forbidden);
}
