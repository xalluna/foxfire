using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// An account's puuid under the key TFT is fetched with.
///
/// Riot encrypts a puuid per key. While TFT shares the main key, an account's
/// TFT puuid is <see cref="RiotAccount.Puuid"/> and nothing here has anything to
/// do. Give TFT a key of its own and every account has a second puuid, resolved
/// from its Riot ID through that key and kept in <see cref="ScopedPuuid"/> — and
/// every TFT board already stored under the main puuid has to follow it, or the
/// account's TFT history would read as empty. Take the key away and they move
/// back.
///
/// Reconciled lazily, whenever an account's TFT puuid is asked for, so changing
/// the configuration needs no migration and no step a host has to remember.
/// </summary>
public sealed class TftIdentity(
    FoxfireDbContext db,
    TftRiot tft,
    IdentityRepair mainKey,
    TimeProvider time,
    ILogger<TftIdentity> log)
{
    /// <summary>
    /// The account's TFT puuid, resolving it and moving its boards onto it when
    /// TFT's key has changed since they were stored.
    /// </summary>
    public async Task<string> PuuidAsync(
        RiotAccount account,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(account);

        var scoped = await db.ScopedPuuids
            .FirstOrDefaultAsync(s => s.RiotAccountId == account.Id && s.Scope == RiotKeyScope.Tft, cancellationToken);

        if (!tft.HasOwnKey)
        {
            // A TFT key was set once and has gone: its puuids mean nothing to
            // the main key, so its boards come back onto the main one.
            if (scoped is not null) await MoveAsync(account, scoped.Puuid, account.Puuid, scoped, cancellationToken);
            return account.Puuid;
        }

        if (scoped is not null) return scoped.Puuid;

        var resolved = await tft.Client.GetAccountByRiotIdAsync(
            account.RegionalRoute, account.GameName, account.TagLine, priority, cancellationToken);

        var taken = await db.ScopedPuuids.AnyAsync(
            s => s.Scope == RiotKeyScope.Tft && s.Puuid == resolved.Puuid && s.RiotAccountId != account.Id,
            cancellationToken);

        if (taken)
        {
            throw new InvalidOperationException(
                $"Cannot file {account.RiotId}'s TFT games: another account already holds that TFT id.");
        }

        db.ScopedPuuids.Add(new ScopedPuuid
        {
            RiotAccountId = account.Id,
            Scope = RiotKeyScope.Tft,
            Puuid = resolved.Puuid,
            ResolvedAt = time.GetUtcNow()
        });

        await db.SaveChangesAsync(cancellationToken);

        // Boards stored while TFT shared the main key are under the main puuid.
        if (await db.TftParticipants.AnyAsync(p => p.Puuid == account.Puuid, cancellationToken))
        {
            await MoveAsync(account, account.Puuid, resolved.Puuid, scoped: null, cancellationToken);
        }

        log.LogInformation("Resolved {RiotId} under this server's TFT key", account.RiotId);
        return resolved.Puuid;
    }

    /// <summary>
    /// Re-resolves an account whose TFT puuid Riot no longer decrypts.
    ///
    /// On the main key that is the main puuid, which <see cref="IdentityRepair"/>
    /// already knows how to move — for both games' rows. On TFT's own key it is
    /// the scoped one, and only TFT's rows follow.
    /// </summary>
    public async Task<IdentityOutcome> RepairAsync(RiotAccount account, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(account);

        if (!tft.HasOwnKey) return await mainKey.RepairAsync(account.Id, cancellationToken);

        var scoped = await db.ScopedPuuids
            .FirstOrDefaultAsync(s => s.RiotAccountId == account.Id && s.Scope == RiotKeyScope.Tft, cancellationToken);

        RiotAccountDto resolved;
        try
        {
            resolved = await tft.Client.GetAccountByRiotIdAsync(
                account.RegionalRoute, account.GameName, account.TagLine,
                RiotRequestPriority.Interactive, cancellationToken);
        }
        catch (RiotApiException ex) when (ex.Status == 404)
        {
            return IdentityOutcome.Unresolved;
        }
        catch (RiotApiException ex)
        {
            log.LogWarning(ex, "Could not re-resolve {RiotId} under the TFT key", account.RiotId);
            return IdentityOutcome.Failed;
        }

        if (scoped is null || scoped.Puuid == resolved.Puuid) return IdentityOutcome.Unchanged;

        await MoveAsync(account, scoped.Puuid, resolved.Puuid, scoped, cancellationToken);
        return IdentityOutcome.Repaired;
    }

    /// <summary>
    /// The accounts this server tracks behind a set of TFT puuids, for a lobby
    /// and for co-players. Under the main key by their own puuid, under TFT's
    /// own by the scoped one.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, Guid>> AccountsByPuuidAsync(
        IReadOnlyCollection<string> puuids,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(puuids);
        if (puuids.Count == 0) return new Dictionary<string, Guid>();

        if (tft.HasOwnKey)
        {
            return await db.ScopedPuuids.AsNoTracking()
                .Where(s => s.Scope == RiotKeyScope.Tft && puuids.Contains(s.Puuid))
                .ToDictionaryAsync(s => s.Puuid, s => s.RiotAccountId, cancellationToken);
        }

        return await db.RiotAccounts.AsNoTracking()
            .Where(a => puuids.Contains(a.Puuid))
            .ToDictionaryAsync(a => a.Puuid, a => a.Id, cancellationToken);
    }

    /// <summary>
    /// Moves TFT's boards from one puuid to another, retiring the old one, and
    /// keeps the scoped row in step: updated when it is still TFT's key, gone
    /// when the boards are going back to the main puuid.
    /// </summary>
    private async Task MoveAsync(
        RiotAccount account,
        string from,
        string to,
        ScopedPuuid? scoped,
        CancellationToken cancellationToken)
    {
        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);

            var moved = await PuuidHistory.MoveAsync(db, from, to, cancellationToken, ParticipantTables.Tft);

            if (scoped is not null)
            {
                if (to == account.Puuid)
                {
                    db.ScopedPuuids.Remove(scoped);
                }
                else
                {
                    scoped.Puuid = to;
                    scoped.ResolvedAt = time.GetUtcNow();
                }
            }

            // The main puuid is never retired from here: it is still League's.
            if (from != account.Puuid
                && !await db.RetiredPuuids.AnyAsync(r => r.RiotAccountId == account.Id && r.Puuid == from, cancellationToken))
            {
                db.RetiredPuuids.Add(new RetiredPuuid
                {
                    RiotAccountId = account.Id,
                    Puuid = from,
                    Scope = RiotKeyScope.Tft,
                    RetiredAt = time.GetUtcNow()
                });
            }

            await db.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            log.LogInformation(
                "Moved {RiotId}'s TFT history onto another key's id: {Matches} match(es), {Participants} board(s)",
                account.RiotId,
                moved.Matches,
                moved.Participants);
        });
    }
}
