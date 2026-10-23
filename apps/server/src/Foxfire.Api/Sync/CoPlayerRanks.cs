using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>
/// Reading rank for everybody else a sync just found in a ranked game.
///
/// A sync reads rank for the account it ran for and nobody else. Two members who
/// queued together both finish the game, but only the one whose client reported
/// it gets a post-game sync: the other's history gains the game from the same
/// payload, and nothing reads where it left them. Their next reading came from
/// whatever synced them next — games later, so the stretch in between swallowed
/// several games and none could be split, and at whatever moment somebody
/// pressed Sync now, often mid-game.
///
/// So once a sync has stored ranked games, every other tracked account in them is
/// read too. Riot publishes a game only after it has ended, so the reading lands
/// after it however soon it is taken, which is where a game is placed (see
/// <see cref="GameTimes"/>). A reading Riot has not caught up on yet is the rank
/// the account went in with, which the dedupe drops when the reading before the
/// game already said so.
///
/// An account already read since the game ended — by its own League client, its
/// own sync — is left alone, and so is one whose own sync is under way, which
/// ends in a reading of its own. What is left costs one request each.
/// </summary>
public sealed class CoPlayerRanks(
    FoxfireDbContext db,
    RankRecorder ranks,
    AttributionRunner attribution,
    TftIdentity tftIdentity,
    IServerEvents events,
    TimeProvider time,
    ILogger<CoPlayerRanks> log)
{
    /// <summary>A co-player and the game they shared, as far as reading them needs.</summary>
    private sealed record Shared(Guid AccountId, string Puuid, int? QueueId, long End);

    /// <summary>
    /// Reads every tracked account other than <paramref name="syncedAccountId"/>
    /// that played one of <paramref name="matchIds"/> on a ranked ladder and has
    /// not been read since. Returns how many were read.
    ///
    /// A failure is logged and skipped rather than thrown: the games are already
    /// stored, and the co-player's own next sync can still supply what one
    /// reading missed. A key Riot has refused stops the rest, which would only
    /// fail the same way.
    /// </summary>
    /// <param name="syncing">Whether an account's own sync is running right now.</param>
    public Task<int> ReadAsync(
        Guid syncedAccountId,
        IReadOnlyCollection<string> matchIds,
        Func<Guid, bool> syncing,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default) =>
        ReadAsync(Game.Lol, syncedAccountId, matchIds, syncing, priority, cancellationToken);

    /// <summary>
    /// The same for one game's games: League's co-players from its participants,
    /// TFT's from its boards, each read on that game's ladders.
    /// </summary>
    public async Task<int> ReadAsync(
        Game game,
        Guid syncedAccountId,
        IReadOnlyCollection<string> matchIds,
        Func<Guid, bool> syncing,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(matchIds);
        ArgumentNullException.ThrowIfNull(syncing);

        if (matchIds.Count == 0) return 0;

        var shared = game == Game.Tft
            ? await SharedTftAsync(syncedAccountId, matchIds, cancellationToken)
            : await SharedLolAsync(syncedAccountId, matchIds, cancellationToken);

        var read = 0;

        foreach (var coPlayer in shared.GroupBy(x => x.AccountId))
        {
            if (syncing(coPlayer.Key)) continue;

            var ends = coPlayer
                .GroupBy(x => RankedQueues.FromQueueId(x.QueueId)!.Value)
                .Select(ladder => (Queue: ladder.Key, End: ladder.Max(x => x.End)));

            if (!await NeedsReadingAsync(coPlayer.Key, ends, cancellationToken)) continue;

            var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == coPlayer.Key, cancellationToken);
            if (account is null) continue;

            try
            {
                var since = time.GetUtcNow().ToUnixTimeMilliseconds() - AttributionRunner.ReplayWindowMs;

                if (game == Game.Tft)
                {
                    var puuid = coPlayer.First().Puuid;
                    await ranks.RefreshTftFromRiotAsync(account, puuid, priority, cancellationToken);
                    await attribution.ReplayAsync(account.Id, Game.Tft, puuid, since, cancellationToken);
                }
                else
                {
                    await ranks.RefreshFromRiotAsync(account, priority, cancellationToken);
                    await attribution.ReplayAsync(account.Id, account.Puuid, since, cancellationToken);
                }

                // Their history gained the game as well as, perhaps, its LP, and
                // the sync that stored it only announced the account it ran for.
                await events.RankChangedAsync(account.Id, cancellationToken);
                read++;
            }
            catch (RiotApiException ex) when (ex.IsKeyRejection || ex.NoProductAccess)
            {
                log.LogDebug("Stopped reading co-players' rank: Riot refused this server's key");
                break;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogDebug(ex, "Rank reading failed for co-player {RiotId}", account.RiotId);
            }
        }

        return read;
    }

    private async Task<IReadOnlyList<Shared>> SharedLolAsync(
        Guid syncedAccountId,
        IReadOnlyCollection<string> matchIds,
        CancellationToken cancellationToken)
    {
        var rankedQueueIds = RankedQueues.Of(Game.Lol).Select(q => q.QueueId()).ToList();

        // A remake moves no LP, so a co-player who only shared one has nothing to
        // read. Games that failed to store are simply not here.
        var played = await db.MatchParticipants.AsNoTracking()
            .Where(p => matchIds.Contains(p.MatchId) && !p.GameEndedInEarlySurrender)
            .Join(
                db.Matches.AsNoTracking(),
                p => p.MatchId,
                m => m.MatchId,
                (p, m) => new { p.Puuid, m.QueueId, m.GameCreation, m.GameDuration })
            .Where(x => x.QueueId != null && rankedQueueIds.Contains(x.QueueId.Value))
            .Join(
                db.RiotAccounts.AsNoTracking(),
                x => x.Puuid,
                a => a.Puuid,
                (x, a) => new { AccountId = a.Id, x.Puuid, x.QueueId, x.GameCreation, x.GameDuration })
            .Where(x => x.AccountId != syncedAccountId)
            .ToListAsync(cancellationToken);

        return [.. played.Select(x => new Shared(x.AccountId, x.Puuid, x.QueueId, GameTimes.End(x.GameCreation, x.GameDuration)))];
    }

    /// <summary>
    /// TFT's co-players: the other boards in the games, each placed at that
    /// player's own elimination, which is when their LP moved.
    /// </summary>
    private async Task<IReadOnlyList<Shared>> SharedTftAsync(
        Guid syncedAccountId,
        IReadOnlyCollection<string> matchIds,
        CancellationToken cancellationToken)
    {
        var rankedQueueIds = RankedQueues.Of(Game.Tft).Select(q => q.QueueId()).ToList();

        var played = await db.TftParticipants.AsNoTracking()
            .Where(p => matchIds.Contains(p.MatchId))
            .Join(
                db.Matches.AsNoTracking(),
                p => p.MatchId,
                m => m.MatchId,
                (p, m) => new { p.Puuid, m.QueueId, m.GameCreation, m.GameDuration, p.TimeEliminated })
            .Where(x => x.QueueId != null && rankedQueueIds.Contains(x.QueueId.Value))
            .ToListAsync(cancellationToken);

        var accounts = await tftIdentity.AccountsByPuuidAsync([.. played.Select(x => x.Puuid).Distinct()], cancellationToken);

        return
        [
            .. played
                .Where(x => accounts.TryGetValue(x.Puuid, out var id) && id != syncedAccountId)
                .Select(x => new Shared(
                    accounts[x.Puuid],
                    x.Puuid,
                    x.QueueId,
                    TftPlacements.GameEnd(x.GameCreation, x.TimeEliminated, x.GameDuration)))
        ];
    }

    /// <summary>
    /// Whether nothing has read the account on some ladder since the last game
    /// it shared there ended.
    /// </summary>
    private async Task<bool> NeedsReadingAsync(
        Guid riotAccountId,
        IEnumerable<(RankedQueue Queue, long End)> ends,
        CancellationToken cancellationToken)
    {
        foreach (var (queue, end) in ends)
        {
            var queueType = queue.RiotName();

            var readSince = await db.RankSnapshots.AsNoTracking().AnyAsync(
                r => r.RiotAccountId == riotAccountId && r.QueueType == queueType && r.CapturedAt >= end,
                cancellationToken);

            if (!readSince) return true;
        }

        return false;
    }
}
