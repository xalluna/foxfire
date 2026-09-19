using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Import;

/// <summary>An account out of somebody's stats.db, as that file describes it.</summary>
/// <param name="Puuid">
/// The one the desktop stored, which is dead here and is sent anyway — it is the
/// key every other row in that file is joined on, and the only way to know which
/// imported rows belong to which account.
/// </param>
public sealed record ImportAccount(string GameName, string TagLine, string? Platform, string Puuid);

/// <summary>What became of one imported account.</summary>
public sealed record ImportAccountResult(string RiotId, Guid? AccountId, bool Resolved, string? Message);

/// <summary>
/// Re-resolves each account and records what its old puuid used to mean.
///
/// One Riot request per account, at interactive priority because somebody is
/// watching an import run. An account that cannot be resolved is reported and
/// skipped rather than failing the batch: a renamed account is a thing its
/// owner can fix afterwards, and the other nine should not wait for it.
///
/// They arrive unlinked, deliberately. The file says which League accounts its
/// owner played; it says nothing about who on this server they are, and that
/// answer is attested by a running League client rather than asserted by an
/// import.
/// </summary>
public sealed record ImportAccountsRequest(IReadOnlyList<ImportAccount> Accounts)
    : IValidatedRequest<IReadOnlyList<ImportAccountResult>>, IImportBatch
{
    public int Count => Accounts?.Count ?? 0;
}

internal sealed class ImportAccountsRequestValidator : ImportBatchValidator<ImportAccountsRequest>;

internal sealed class ImportAccountsRequestHandler(
    FoxfireDbContext db,
    RiotClient riot,
    TimeProvider time,
    ILogger<ImportAccountsRequestHandler> logger)
    : IValidatedRequestHandler<ImportAccountsRequest, IReadOnlyList<ImportAccountResult>>
{
    public async Task<Response<IReadOnlyList<ImportAccountResult>>> Handle(
        ImportAccountsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.Count == 0)
        {
            return Response<IReadOnlyList<ImportAccountResult>>.Success([]);
        }

        List<ImportAccountResult> results = [];
        var now = time.GetUtcNow();

        foreach (var incoming in request.Accounts)
        {
            var riotId = $"{incoming.GameName}#{incoming.TagLine}";
            var platform = RiotRegions.IsKnownPlatform(incoming.Platform)
                ? incoming.Platform!
                : RiotRegions.DefaultPlatform;

            RiotAccountDto resolved;
            try
            {
                resolved = await riot.GetAccountByRiotIdAsync(
                    RiotRegions.RegionalRouteFor(platform),
                    incoming.GameName,
                    incoming.TagLine,
                    RiotRequestPriority.Interactive,
                    cancellationToken);
            }
            catch (RiotApiException ex) when (ex.Status == 404)
            {
                results.Add(new ImportAccountResult(
                    riotId, null, false, "Riot no longer knows that Riot ID — it was probably renamed."));
                continue;
            }
            catch (RiotApiException ex)
            {
                results.Add(new ImportAccountResult(
                    riotId, null, false, ex.IsKeyRejection
                        ? "This server's Riot API key is not working."
                        : "Riot could not be reached for that account."));
                continue;
            }

            var account = await db.RiotAccounts
                .FirstOrDefaultAsync(a => a.Puuid == resolved.Puuid, cancellationToken);

            if (account is null)
            {
                account = new RiotAccount
                {
                    Id = Guid.CreateVersion7(now),
                    Puuid = resolved.Puuid,
                    GameName = resolved.GameName ?? incoming.GameName,
                    TagLine = resolved.TagLine ?? incoming.TagLine,
                    Platform = platform,
                    RegionalRoute = RiotRegions.RegionalRouteFor(platform),
                    CreatedAt = now,
                    UpdatedAt = now,
                    OwnerId = null
                };

                db.RiotAccounts.Add(account);
            }

            // The record that makes every later batch translatable, and the same
            // record a key rotation leaves behind — it is the same event, with
            // the old key belonging to somebody's desktop instead of to this
            // server's past.
            if (incoming.Puuid != resolved.Puuid)
            {
                var known = await db.RetiredPuuids.AnyAsync(
                    r => r.RiotAccountId == account.Id && r.Puuid == incoming.Puuid, cancellationToken);

                if (!known)
                {
                    db.RetiredPuuids.Add(new RetiredPuuid
                    {
                        RiotAccountId = account.Id,
                        Puuid = incoming.Puuid,
                        RetiredAt = now
                    });
                }
            }

            results.Add(new ImportAccountResult(riotId, account.Id, true, null));
        }

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Imported {Resolved} of {Total} account(s) from a stats.db",
            results.Count(r => r.Resolved),
            results.Count);

        return Response<IReadOnlyList<ImportAccountResult>>.Success(results);
    }
}
