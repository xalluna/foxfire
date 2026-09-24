using System.Net;
using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// Tracking a League account that belongs to nobody here.
///
/// Linking claims an account for the person doing it; this does not. The row is
/// created with no owner, which is a state the model already has and the
/// stats.db import already produces — <see cref="RiotAccount.OwnerId"/> being
/// null has always meant "tracked, unclaimed". What was missing was a way to
/// reach that state on purpose.
///
/// Admin-only, because it spends the community's Riot key on somebody who has
/// not asked to be here and grows the database by however many games they have
/// played. That is a decision about the server, not about an account, and it is
/// the one place an admin is deliberately special-cased.
/// </summary>
public sealed record AddTrackedAccountRequest(string GameName, string TagLine)
    : IValidatedRequest<RiotAccountResponse>;

internal sealed class AddTrackedAccountRequestValidator : AbstractValidator<AddTrackedAccountRequest>
{
    public AddTrackedAccountRequestValidator() =>
        RuleFor(x => x)
            .Must(r => (r.GameName ?? "").Trim().Length > 0 && (r.TagLine ?? "").TrimStart('#').Trim().Length > 0)
            .WithErrorCode("invalid_riot_id")
            .WithMessage("A Riot ID is a name and a tag, like Faker#KR.");
}

internal sealed class AddTrackedAccountRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    RiotClient riot,
    AccountProfile profile,
    SyncService sync,
    TimeProvider time,
    ILogger<AddTrackedAccountRequestHandler> logger)
    : IValidatedRequestHandler<AddTrackedAccountRequest, RiotAccountResponse>
{
    public async Task<Response<RiotAccountResponse>> Handle(
        AddTrackedAccountRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var gameName = (request.GameName ?? "").Trim();
        var tagLine = (request.TagLine ?? "").TrimStart('#').Trim();

        // NA, like linking and import. The column and the routing table are
        // both ready for more; nothing chooses yet.
        var platform = RiotRegions.DefaultPlatform;
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
            logger.LogError("Cannot add accounts: Riot has rejected this server's API key");
            return Response<RiotAccountResponse>.Failure(
                new Error(
                    "riot_key_rejected",
                    "This server's Riot API key is not working. Its administrator needs to replace it."),
                HttpStatusCode.ServiceUnavailable);
        }

        var existing = await db.RiotAccounts
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.Puuid == resolved.Puuid, cancellationToken);

        if (existing is not null)
        {
            // Said plainly rather than silently succeeding: an admin who typed
            // a Riot ID expecting to start tracking it should learn that its
            // history is already here, and whose it is if anybody's.
            var whose = existing.Owner?.UserName is { } owner
                ? $" It is claimed by {owner}."
                : " Nobody has claimed it.";

            return Response<RiotAccountResponse>.Failure(
                new Error("already_tracked", $"This server already tracks {existing.RiotId}.{whose}"),
                HttpStatusCode.Conflict);
        }

        var now = time.GetUtcNow();

        var account = new RiotAccount
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

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Somebody linking the same account in the same moment. The unique
            // index on Puuid decides, and the row that exists is the right one.
            return Response<RiotAccountResponse>.Failure(
                new Error("already_tracked", "Somebody else just added that account."),
                HttpStatusCode.Conflict);
        }

        logger.LogInformation(
            "Admin {UserId} started tracking {RiotId}, unclaimed", me.UserId, account.RiotId);

        // Cosmetic and best-effort, exactly as when linking: an account that
        // appears with an empty frame and no level reads as one that did not
        // work, and the backfill would get to it eventually anyway.
        try
        {
            await profile.RefreshAsync(account, RiotRequestPriority.Interactive, cancellationToken);
        }
        catch (RiotApiException ex)
        {
            logger.LogDebug(ex, "Could not fetch the profile for {RiotId} while adding it", account.RiotId);
        }

        // Not awaited, like every other sync start. Depth is the server-wide
        // backfill target the sync state copies for itself, so there is no
        // second knob for admin-added accounts to disagree with.
        _ = sync.SyncAsync(account.Id, SyncTrigger.Manual, CancellationToken.None);

        return RiotAccountResponse.Describe(account, me.UserId);
    }
}
