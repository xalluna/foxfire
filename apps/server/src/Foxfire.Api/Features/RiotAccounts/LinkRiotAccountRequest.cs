using System.Net;
using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// Claiming a League account.
///
/// LCU-attested and first-writer-wins. The desktop reports the Riot ID the
/// League client running on that machine says is logged in; the server resolves
/// it through account-v1 with its own key and files it. That is not proof —
/// nothing stops a hand-written HTTP client from claiming any Riot ID — and the
/// design accepts that in exchange for a link that costs an honest person
/// nothing. What makes it survivable is that an admin can force-unlink.
///
/// Note what the desktop does NOT send: a puuid. The League client's own player
/// id is not Riot's, and Riot's is encrypted per API key, so the client's copy
/// would be meaningless here even if it offered one.
/// </summary>
public sealed record LinkRiotAccountRequest(string GameName, string TagLine, string? Platform)
    : IValidatedRequest<RiotAccountResponse>;

internal sealed class LinkRiotAccountRequestValidator : AbstractValidator<LinkRiotAccountRequest>
{
    public LinkRiotAccountRequestValidator() =>
        RuleFor(x => x)
            .Must(r => (r.GameName ?? "").Trim().Length > 0 && (r.TagLine ?? "").TrimStart('#').Trim().Length > 0)
            .WithErrorCode("invalid_riot_id")
            .WithMessage("A Riot ID is a name and a tag, like Faker#KR.");
}

internal sealed class LinkRiotAccountRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    RiotClient riot,
    TimeProvider time,
    ILogger<LinkRiotAccountRequestHandler> logger)
    : IValidatedRequestHandler<LinkRiotAccountRequest, RiotAccountResponse>
{
    private static Response<RiotAccountResponse> AlreadyLinked(string message) =>
        Response<RiotAccountResponse>.Failure(new Error("already_linked", message), HttpStatusCode.Conflict);

    public async Task<Response<RiotAccountResponse>> Handle(
        LinkRiotAccountRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (me.UserId is not { } userId)
        {
            return Response<RiotAccountResponse>.Failure(
                new Error("unauthenticated", "Sign in again."), HttpStatusCode.Unauthorized);
        }

        var gameName = (request.GameName ?? "").Trim();
        var tagLine = (request.TagLine ?? "").TrimStart('#').Trim();

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
            return Response<RiotAccountResponse>.Failure(
                new Error(
                    "riot_account_not_found",
                    $"Riot has no account called {gameName}#{tagLine} in this region."),
                HttpStatusCode.NotFound);
        }
        catch (RiotApiException ex) when (ex.IsKeyRejection)
        {
            // Worth its own answer. Nothing the person did is wrong, and there
            // is nothing they can do about it — this is the host's problem.
            logger.LogError("Cannot link accounts: Riot has rejected this server's API key");
            return Response<RiotAccountResponse>.Failure(
                new Error(
                    "riot_key_rejected",
                    "This server's Riot API key is not working. Its administrator needs to replace it."),
                HttpStatusCode.ServiceUnavailable);
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

        if (account.OwnerId is not null && account.OwnerId != userId)
        {
            return AlreadyLinked(
                $"{account.RiotId} is already linked to another Foxfire account on this server. "
                + "An administrator can unlink it.");
        }

        if (account.OwnerId is null)
        {
            account.OwnerId = userId;
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
            return AlreadyLinked("Somebody else just linked that account.");
        }

        logger.LogInformation("Linked {RiotId} to user {UserId}", account.RiotId, userId);

        await db.Entry(account).Reference(a => a.Owner).LoadAsync(cancellationToken);
        return RiotAccountResponse.Describe(account, userId);
    }
}
