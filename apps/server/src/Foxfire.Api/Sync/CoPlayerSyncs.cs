using Foxfire.Core;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// Syncing everybody else a sync just found in a game.
///
/// A sync fetches the history of the account it ran for and nobody else's. Two
/// members who queued together both finish the game, but only the one whose
/// client reported it gets a post-game sync: the other's history gains that game
/// from the same payload, and nothing fetches what they played before it. Those
/// games stayed missing until somebody pressed Sync now.
///
/// What used to happen instead was a rank reading for each of them, taken in
/// place, which made it worse. The reading closed the stretch since their last
/// one with only the shared game in it, so the shared game was handed the LP of
/// every game they had played since — and attribution only ever adds, so when
/// the others did arrive the wrong row stayed.
///
/// So every other tracked account in the games a sync stored gets a sync of its
/// own. It is an ordinary run: what was missing first, the reading after, the
/// order attribution depends on. It is started rather than awaited — it is that
/// member's history, on that member's run, announced on that member's progress
/// events — and its requests wait in Riot's queue as post-game work, behind
/// anybody watching a spinner.
///
/// Left alone: an account whose own sync is under way, which is already doing
/// this, and one with a post-game ladder of its own waiting — its own client said
/// its game ended, and the ladder will find it.
/// </summary>
public sealed class CoPlayerSyncs(
    FoxfireDbContext db,
    TftIdentity tftIdentity,
    SyncService sync,
    PostGameSyncScheduler ladders)
{
    /// <summary>
    /// Queues a sync of <paramref name="game"/> for every tracked account other
    /// than <paramref name="syncedAccountId"/> that played one of
    /// <paramref name="matchIds"/>. Returns how many were queued.
    /// </summary>
    public async Task<int> QueueAsync(
        Game game,
        Guid syncedAccountId,
        IReadOnlyCollection<string> matchIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(matchIds);

        if (matchIds.Count == 0) return 0;

        // Games that failed to store are simply not here.
        var coPlayers = game == Game.Tft
            ? await TftCoPlayersAsync(matchIds, cancellationToken)
            : await LolCoPlayersAsync(matchIds, cancellationToken);

        var queued = 0;

        foreach (var riotAccountId in coPlayers)
        {
            if (riotAccountId == syncedAccountId) continue;
            if (sync.IsSyncing(riotAccountId, game) || ladders.IsScheduled(riotAccountId, game)) continue;

            // A failure is that run's own, logged and announced by it.
            _ = sync.SyncAsync(riotAccountId, game, SyncTrigger.Auto, CancellationToken.None);
            queued++;
        }

        return queued;
    }

    private async Task<IReadOnlyList<Guid>> LolCoPlayersAsync(
        IReadOnlyCollection<string> matchIds,
        CancellationToken cancellationToken) =>
        await db.MatchParticipants.AsNoTracking()
            .Where(p => matchIds.Contains(p.MatchId))
            .Join(db.RiotAccounts.AsNoTracking(), p => p.Puuid, a => a.Puuid, (p, a) => a.Id)
            .Distinct()
            .ToListAsync(cancellationToken);

    /// <summary>TFT's co-players: the other boards in the lobbies, by the puuid TFT's key knows them by.</summary>
    private async Task<IReadOnlyList<Guid>> TftCoPlayersAsync(
        IReadOnlyCollection<string> matchIds,
        CancellationToken cancellationToken)
    {
        var puuids = await db.TftParticipants.AsNoTracking()
            .Where(p => matchIds.Contains(p.MatchId))
            .Select(p => p.Puuid)
            .Distinct()
            .ToListAsync(cancellationToken);

        var accounts = await tftIdentity.AccountsByPuuidAsync(puuids, cancellationToken);
        return [.. accounts.Values.Distinct()];
    }
}
