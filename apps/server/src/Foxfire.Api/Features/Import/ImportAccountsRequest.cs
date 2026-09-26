using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
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
/// <param name="HealedMatches">
/// Games already stored under this account's dead id that were moved onto the id
/// that works — only ever non-zero on the run that first learns what the dead id
/// meant.
/// </param>
public sealed record ImportAccountResult(
    string RiotId,
    Guid? AccountId,
    bool Resolved,
    string? Message,
    int HealedMatches = 0);

/// <summary>
/// Re-resolves each account and records what its old puuid used to mean.
///
/// One Riot request per account the server has never met, at interactive
/// priority because somebody is watching an import run. An account whose id it
/// already has a record for is answered from that record — the lookup could only
/// tell it what it already knows, and a re-upload of a year-old file would
/// otherwise spend a request per account to learn nothing.
///
/// An account that cannot be resolved is reported and skipped rather than
/// failing the batch: a renamed account is a thing its owner can fix afterwards,
/// and the other nine should not wait for it. Because it left no record, the
/// next upload asks about it again — which is how a rename gets fixed by
/// importing once more.
///
/// The run that finally resolves such an account also moves the games already
/// stored under its dead id. Those went in when nothing could translate them,
/// and "already stored" skips them for ever after, so without this no amount of
/// re-uploading would bring them back.
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
    IIdentityContext me,
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

        // Which result, and the dead id whose games move to the live one once the
        // mapping that makes that legitimate has been saved.
        List<(int Index, string OldPuuid, string NewPuuid)> heals = [];

        var now = time.GetUtcNow();

        foreach (var incoming in request.Accounts)
        {
            var riotId = $"{incoming.GameName}#{incoming.TagLine}";
            var platform = RiotRegions.IsKnownPlatform(incoming.Platform)
                ? incoming.Platform!
                : RiotRegions.DefaultPlatform;

            var knownId = await KnownAccountAsync(incoming.Puuid, cancellationToken);
            if (knownId is not null)
            {
                results.Add(new ImportAccountResult(riotId, knownId, true, null));
                continue;
            }

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

                    // Nothing could translate this id until now, so anything
                    // stored under it went in untranslated.
                    heals.Add((results.Count, incoming.Puuid, resolved.Puuid));
                }
            }

            results.Add(new ImportAccountResult(riotId, account.Id, true, null));
        }

        var healed = await SaveAsync(heals, cancellationToken);

        foreach (var (index, count) in healed)
        {
            results[index] = results[index] with { HealedMatches = count };
        }

        logger.LogInformation(
            "{Actor} imported {Resolved} of {Total} account(s) from a stats.db",
            me.Username,
            results.Count(r => r.Resolved),
            results.Count);

        return Response<IReadOnlyList<ImportAccountResult>>.Success(results);
    }

    /// <summary>
    /// The account a file's id already means here, whether it is the id the
    /// server uses now or one it has retired.
    /// </summary>
    private async Task<Guid?> KnownAccountAsync(string puuid, CancellationToken cancellationToken)
    {
        var current = await db.RiotAccounts.AsNoTracking()
            .Where(a => a.Puuid == puuid)
            .Select(a => (Guid?)a.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (current is not null) return current;

        return await db.RetiredPuuids.AsNoTracking()
            .Where(r => r.Puuid == puuid)
            .Select(r => (Guid?)r.RiotAccountId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// Files what the batch learned, and moves the games stranded under any id
    /// it learned the meaning of — in one transaction.
    ///
    /// Together, because a mapping saved without the move would make the next
    /// run recognise the id and skip the lookup, and nothing would ever move
    /// those games. A game that already has a row under both ids is left as it
    /// is and counted: moving one onto the other would collide, and that is a
    /// thing to look at rather than to guess at.
    /// </summary>
    private async Task<IReadOnlyDictionary<int, int>> SaveAsync(
        IReadOnlyList<(int Index, string OldPuuid, string NewPuuid)> heals,
        CancellationToken cancellationToken)
    {
        Dictionary<int, int> healed = [];

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            // Cleared on every attempt: a retried transaction starts over.
            healed.Clear();

            await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);
            await db.SaveChangesAsync(cancellationToken);

            foreach (var (index, oldPuuid, newPuuid) in heals)
            {
                var moved = await PuuidHistory.MoveAsync(db, oldPuuid, newPuuid, cancellationToken);
                healed[index] = moved.Matches;

                if (moved.Matches > 0 || moved.Collisions > 0)
                {
                    logger.LogInformation(
                        "Moved {Matches} stored game(s) from an imported account's dead id onto its live one; "
                        + "{Collisions} left alone because both ids were already in them",
                        moved.Matches,
                        moved.Collisions);
                }
            }

            await tx.CommitAsync(cancellationToken);
        });

        return healed;
    }
}
