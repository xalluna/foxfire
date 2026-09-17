using System.Security.Claims;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>What the desktop read out of the running League client.</summary>
public sealed record LinkRiotAccountRequest(string GameName, string TagLine, string? Platform);

/// <summary>A League account as anybody on this server sees it.</summary>
/// <param name="OwnerUsername">Who has claimed it, or null for unclaimed.</param>
/// <param name="IsMine">Whether the caller may edit LP for it.</param>
public sealed record RiotAccountResponse(
    Guid Id,
    string GameName,
    string TagLine,
    string RiotId,
    string Platform,
    Guid? OwnerId,
    string? OwnerUsername,
    bool IsMine,
    DateTimeOffset? LinkedAt);

/// <summary>
/// Claiming a League account, and seeing who has claimed what.
///
/// Claiming is LCU-attested and first-writer-wins. The desktop reports the Riot
/// ID the League client running on that machine says is logged in; the server
/// resolves it through account-v1 with its own key and files it. That is not
/// proof — nothing stops a hand-written HTTP client from claiming any Riot ID —
/// and the design accepts that in exchange for a link that costs an honest
/// person nothing. What makes it survivable is that an admin can force-unlink,
/// which on a server whose admin knows everybody is the right shape of lock.
///
/// Note what the desktop does NOT send: a puuid. The League client's own player
/// id is not Riot's, and Riot's is encrypted per API key — so the client's copy
/// would be meaningless here even if it offered one. The Riot ID is the identity
/// that crosses that boundary, which is why the desktop's LCU watcher already
/// matches on it.
///
/// Reads are open to every member, because everything on this server is: match
/// history is shared, and so is who owns which account. Writes are not — only
/// the owner may release a link, and only an admin may take one away.
/// </summary>
public static class RiotLinkEndpoints
{
    public static void MapRiotLinkEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/riot-accounts").WithTags("Riot accounts").RequireAuthorization();

        group.MapGet("/", ListAsync);
        group.MapPost("/", LinkAsync);
        group.MapDelete("/{id:guid}", UnlinkAsync);

        app.MapDelete("/admin/riot-accounts/{id:guid}/owner", ForceUnlinkAsync)
            .WithTags("Riot accounts")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));
    }

    /// <summary>
    /// Every League account this server tracks, not just the caller's.
    ///
    /// Two things in one list, distinguished by IsMine rather than by being
    /// separate endpoints: the accounts you may edit, and the accounts you may
    /// only look at. The desktop needs both — one to write LP against, one to
    /// render everybody else's games.
    /// </summary>
    private static async Task<IResult> ListAsync(
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        var me = UserId(principal);

        var accounts = await db.RiotAccounts
            .Include(a => a.Owner)
            .OrderBy(a => a.GameName)
            .ToListAsync(cancellationToken);

        return Results.Ok(accounts.Select(a => Describe(a, me)));
    }

    private static async Task<IResult> LinkAsync(
        [FromBody] LinkRiotAccountRequest request,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        RiotClient riot,
        TimeProvider time,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var me = UserId(principal);
        if (me is null) return Results.Unauthorized();

        var gameName = (request.GameName ?? "").Trim();
        var tagLine = (request.TagLine ?? "").TrimStart('#').Trim();

        if (gameName.Length == 0 || tagLine.Length == 0)
        {
            return AuthEndpoints.Problem("invalid_riot_id", "A Riot ID is a name and a tag, like Alluna#NA1.");
        }

        // Region is not yet a thing a caller chooses: everything is NA. The
        // column is on the row and the routing table is complete, so lifting
        // this is a change here rather than a migration.
        var platform = RiotRegions.IsKnownPlatform(request.Platform)
            ? request.Platform!
            : RiotRegions.DefaultPlatform;
        var route = RiotRegions.RegionalRouteFor(platform);

        RiotAccountDto resolved;
        try
        {
            resolved = await riot.GetAccountByRiotIdAsync(
                route, gameName, tagLine, RiotRequestPriority.Interactive, cancellationToken);
        }
        catch (RiotApiException ex) when (ex.Status == 404)
        {
            return AuthEndpoints.Problem(
                "riot_account_not_found",
                $"Riot has no account called {gameName}#{tagLine} in this region.",
                StatusCodes.Status404NotFound);
        }
        catch (RiotApiException ex) when (ex.IsKeyRejection)
        {
            // Worth its own answer. Nothing the person did is wrong, and there
            // is nothing they can do about it — this is the host's problem.
            logger.LogError("Cannot link accounts: Riot has rejected this server's API key");
            return AuthEndpoints.Problem(
                "riot_key_rejected",
                "This server's Riot API key is not working. Its administrator needs to replace it.",
                StatusCodes.Status503ServiceUnavailable);
        }

        var now = time.GetUtcNow();

        // Match on the puuid rather than the name: people rename themselves, and
        // the row that already holds this account's history is the one to claim.
        var account = await db.RiotAccounts
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Puuid == resolved.Puuid, cancellationToken);

        if (account is null)
        {
            account = new RiotAccount
            {
                Id = Guid.CreateVersion7(now),
                Puuid = resolved.Puuid,
                GameName = resolved.GameName ?? gameName,
                TagLine = resolved.TagLine ?? tagLine,
                Platform = platform,
                RegionalRoute = route,
                CreatedAt = now,
                UpdatedAt = now
            };

            db.RiotAccounts.Add(account);
        }
        else
        {
            // Riot is the authority on what this account is called now.
            account.GameName = resolved.GameName ?? account.GameName;
            account.TagLine = resolved.TagLine ?? account.TagLine;
            account.UpdatedAt = now;
        }

        if (account.OwnerId is not null && account.OwnerId != me)
        {
            return AuthEndpoints.Problem(
                "already_linked",
                $"{account.RiotId} is already linked to another Foxfire account on this server. "
                + "An administrator can unlink it.",
                StatusCodes.Status409Conflict);
        }

        if (account.OwnerId is null)
        {
            account.OwnerId = me;
            account.LinkedAt = now;
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two people claiming the same unowned account at the same moment.
            // The unique index on Puuid decides; the loser is told the truth.
            return AuthEndpoints.Problem(
                "already_linked",
                "Somebody else just linked that account.",
                StatusCodes.Status409Conflict);
        }

        logger.LogInformation("Linked {RiotId} to user {UserId}", account.RiotId, me);

        await db.Entry(account).Reference(a => a.Owner).LoadAsync(cancellationToken);
        return Results.Ok(Describe(account, me));
    }

    /// <summary>Gives up your own claim. The account and its games stay.</summary>
    private static async Task<IResult> UnlinkAsync(
        Guid id,
        ClaimsPrincipal principal,
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        var me = UserId(principal);
        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == id, cancellationToken);

        if (account is null) return Results.NotFound();
        if (account.OwnerId != me) return Results.Forbid();

        account.OwnerId = null;
        account.LinkedAt = null;
        await db.SaveChangesAsync(cancellationToken);

        return Results.NoContent();
    }

    /// <summary>
    /// The escape hatch that makes first-writer-wins liveable.
    ///
    /// Somebody claims an account that is not theirs, or leaves the community
    /// still holding one, or mistypes into a smurf nobody can now claim. Without
    /// this, every one of those is permanent.
    /// </summary>
    private static async Task<IResult> ForceUnlinkAsync(
        Guid id,
        FoxfireDbContext db,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == id, cancellationToken);
        if (account is null) return Results.NotFound();

        var previous = account.OwnerId;
        account.OwnerId = null;
        account.LinkedAt = null;
        await db.SaveChangesAsync(cancellationToken);

        logger.LogWarning(
            "An admin unlinked {RiotId} from user {UserId}", account.RiotId, previous);

        return Results.NoContent();
    }

    private static Guid? UserId(ClaimsPrincipal principal) =>
        Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    private static RiotAccountResponse Describe(RiotAccount account, Guid? me) =>
        new(account.Id,
            account.GameName,
            account.TagLine,
            account.RiotId,
            account.Platform,
            account.OwnerId,
            account.Owner?.UserName,
            IsMine: me is not null && account.OwnerId == me,
            account.LinkedAt);
}
