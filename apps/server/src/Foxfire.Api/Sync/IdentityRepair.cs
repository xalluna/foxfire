using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// Putting an account back together after the server's Riot key changed.
///
/// Riot encrypts a puuid against the key that asked for it. Replace the key —
/// which for a personal key is every twenty-four hours — and every puuid this
/// server has ever stored becomes a value Riot answers with 400 "Exception
/// decrypting". Nothing is lost when that happens; each account simply has to be
/// introduced again.
///
/// The Riot ID is what makes that possible. It is the only handle here that Riot
/// does not encrypt, which is why it is also what linking runs on and what the
/// desktop's LCU watcher matches against.
///
/// Repairs happen lazily, when a request is actually rejected, rather than in a
/// sweep at startup. A sweep would cost one Riot request per account on every
/// boot to discover, nearly always, that nothing had changed — out of a budget
/// of a hundred every two minutes for the entire server. Waiting for the 400
/// costs one wasted request per account, once, on the boot after a rotation.
///
/// Note what is *not* repaired: the puuids of strangers on participant rows.
/// Nine of the ten players in a match are usually not members here, their puuids
/// are just as dead, and re-resolving them would cost a Riot request each for
/// history nobody can query by them anyway. Every lookup that matters goes
/// through a RiotAccount, and those are the ones this fixes. The desktop makes
/// the same trade for the same reason.
/// </summary>
public sealed class IdentityRepair(
    FoxfireDbContext db,
    RiotClient riot,
    TimeProvider time,
    ILogger<IdentityRepair> log)
{
    /// <summary>
    /// Re-resolves one account and, when the puuid moved, rewrites its history
    /// onto the new one.
    ///
    /// A rename is reported rather than guessed at: the account keeps its history
    /// and its old puuid, and somebody links it again under the name it now plays
    /// under. Deleting rows because a lookup missed would be a poor trade for a
    /// problem one re-link solves.
    ///
    /// Anything else — a rejected key, a rate limit, a network failure — is
    /// <see cref="IdentityOutcome.Failed"/>. Those are not "this account is
    /// broken", and treating them as such would retire a perfectly good puuid on
    /// the strength of a timeout.
    /// </summary>
    public async Task<IdentityOutcome> RepairAsync(Guid riotAccountId, CancellationToken cancellationToken = default)
    {
        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == riotAccountId, cancellationToken)
            ?? throw new InvalidOperationException($"Unknown Riot account {riotAccountId}");

        RiotAccountDto resolved;
        try
        {
            resolved = await riot.GetAccountByRiotIdAsync(
                account.RegionalRoute,
                account.GameName,
                account.TagLine,
                RiotRequestPriority.Interactive,
                cancellationToken);
        }
        catch (RiotApiException ex) when (ex.Status == 404)
        {
            log.LogInformation("Riot no longer knows {RiotId}", account.RiotId);
            return IdentityOutcome.Unresolved;
        }
        catch (RiotApiException ex)
        {
            log.LogWarning(ex, "Could not re-resolve {RiotId}", account.RiotId);
            return IdentityOutcome.Failed;
        }

        if (resolved.Puuid == account.Puuid) return IdentityOutcome.Unchanged;

        await RekeyAsync(account, resolved.Puuid, cancellationToken);
        return IdentityOutcome.Repaired;
    }

    /// <summary>
    /// Moves every stored row from one puuid to another, atomically.
    ///
    /// The raw payload is rewritten too, by textual replacement. That looks
    /// crude and is exactly right: the payload is kept so future columns can be
    /// backfilled out of it, and a backfill reading a puuid that no longer
    /// matches the participant row beside it would write mismatched data. The
    /// old value appears in the metadata roster and in one participant block,
    /// and both should become the new one.
    /// </summary>
    private async Task RekeyAsync(RiotAccount account, string newPuuid, CancellationToken cancellationToken)
    {
        var oldPuuid = account.Puuid;

        var takenBy = await db.RiotAccounts
            .Where(a => a.Puuid == newPuuid && a.Id != account.Id)
            .Select(a => a.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (takenBy != Guid.Empty)
        {
            // Two Riot accounts resolving to one puuid means one of them is a
            // duplicate row, which is a thing to look at rather than to merge
            // automatically — merging would silently join two people's history.
            throw new InvalidOperationException(
                $"Cannot re-key {account.RiotId}: Riot account {takenBy} already holds that puuid.");
        }

        var collisions = await db.MatchParticipants
            .Where(mine => mine.Puuid == oldPuuid
                && db.MatchParticipants.Any(theirs => theirs.MatchId == mine.MatchId && theirs.Puuid == newPuuid))
            .CountAsync(cancellationToken);

        if (collisions > 0)
        {
            // Both puuids already present in the same match: the composite key
            // would collide. Only reachable from a half-applied earlier re-key,
            // and worth failing loudly rather than losing rows to it.
            throw new InvalidOperationException(
                $"Cannot re-key {account.RiotId}: {collisions} match(es) already hold a row for the new puuid.");
        }

        var strategy = db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(cancellationToken);

            // Before the participant rows move, while the old puuid still
            // selects the matches to touch.
            var matches = await db.Matches
                .Where(m => db.MatchParticipants.Any(p => p.MatchId == m.MatchId && p.Puuid == oldPuuid))
                .ExecuteUpdateAsync(
                    s => s.SetProperty(m => m.RawJson, m => m.RawJson.Replace(oldPuuid, newPuuid)),
                    cancellationToken);

            var participants = await db.MatchParticipants
                .Where(p => p.Puuid == oldPuuid)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.Puuid, newPuuid), cancellationToken);

            await db.RiotAccounts
                .Where(a => a.Id == account.Id)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(a => a.Puuid, newPuuid)
                          .SetProperty(a => a.UpdatedAt, time.GetUtcNow()),
                    cancellationToken);

            var alreadyRetired = await db.RetiredPuuids
                .AnyAsync(r => r.RiotAccountId == account.Id && r.Puuid == oldPuuid, cancellationToken);

            if (!alreadyRetired)
            {
                db.RetiredPuuids.Add(new RetiredPuuid
                {
                    RiotAccountId = account.Id,
                    Puuid = oldPuuid,
                    RetiredAt = time.GetUtcNow()
                });

                await db.SaveChangesAsync(cancellationToken);
            }

            await tx.CommitAsync(cancellationToken);

            log.LogInformation(
                "Re-keyed {RiotId} after an API key change: {Matches} match(es), {Participants} participant row(s)",
                account.RiotId,
                matches,
                participants);
        });

        // ExecuteUpdate went round the change tracker, so the entity this method
        // was handed still holds the dead value. Callers use it immediately.
        account.Puuid = newPuuid;
        db.Entry(account).Property(a => a.Puuid).IsModified = false;
    }
}
