using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>Where a rank reading came from.</summary>
public static class RankSources
{
    /// <summary>A running League client told us, via the desktop.</summary>
    public const string Lcu = "lcu";

    /// <summary>Riot's league-v4, asked by this server.</summary>
    public const string LeagueV4 = "league_v4";

    /// <summary>Somebody typed it in.</summary>
    public const string Manual = "manual";
}

/// <summary>One reading, in the shape both sources deliver it.</summary>
public sealed record RankReadingInput(
    string QueueType,
    RankTier? Tier,
    RankDivision? Division,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    RatedTier? RatedTier = null,
    int? RatedRating = null);

/// <summary>
/// Recording rank, for both the things that observe it.
///
/// The desktop has two: a running League client, which notices a single game's
/// worth of movement the moment it happens, and league-v4, which catches
/// whatever moved while the app was closed. The server keeps both — the first
/// arrives over HTTP from a desktop that saw it, the second it asks for itself
/// after a sync — and they go through one method here for the same reason they
/// go through one function there: the append rule, the "did it actually move"
/// test and the attribution that follows all have to be true of both.
///
/// LeagueEntries holds only the current value and is overwritten on every
/// refresh. RankSnapshots is append-only, and everything about LP is derived
/// from pairs of rows in it.
/// </summary>
public sealed class RankRecorder(FoxfireDbContext db, RiotClient riot, TftRiot tft, TimeProvider time)
{
    /// <summary>
    /// Asks Riot where this account stands and records what it says.
    ///
    /// Returns the current entries, which is what the profile card wants, and
    /// appends a reading per queue on the way past.
    /// </summary>
    public async Task<IReadOnlyList<LeagueEntry>> RefreshFromRiotAsync(
        RiotAccount account,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(account);

        var entries = await riot.GetLeagueEntriesAsync(
            account.Platform, account.Puuid, priority, cancellationToken);

        var now = time.GetUtcNow();

        // League's ladders only. league-v4 has answered with queues nobody
        // tracks before, and every one of them used to be stored and read back
        // onto League's profile.
        foreach (var entry in entries.Where(e => RankedQueues.FromRiotName(e.QueueType, Game.Lol) is not null))
        {
            // Riot's spelling, turned into the type, once — and null when it
            // is a tier this server has never heard of, which reads the same
            // way an unranked account does.
            var tier = RankTiers.FromRiotName(entry.Tier);
            var division = RankDivisions.FromRiotName(entry.Division);

            var existing = await db.LeagueEntries.FirstOrDefaultAsync(
                l => l.RiotAccountId == account.Id && l.QueueType == entry.QueueType,
                cancellationToken);

            if (existing is null)
            {
                db.LeagueEntries.Add(new LeagueEntry
                {
                    RiotAccountId = account.Id,
                    QueueType = entry.QueueType,
                    Tier = tier,
                    Division = division,
                    LeaguePoints = entry.LeaguePoints,
                    Wins = entry.Wins,
                    Losses = entry.Losses,
                    FetchedAt = now
                });
            }
            else
            {
                existing.Tier = tier;
                existing.Division = division;
                existing.LeaguePoints = entry.LeaguePoints;
                existing.Wins = entry.Wins;
                existing.Losses = entry.Losses;
                existing.FetchedAt = now;
            }

            await RecordAsync(
                account.Id,
                new RankReadingInput(
                    entry.QueueType, tier, division, entry.LeaguePoints, entry.Wins, entry.Losses),
                RankSources.LeagueV4,
                now.ToUnixTimeMilliseconds(),
                force: false,
                cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);

        var ladders = RankedQueues.Of(Game.Lol).Select(q => q.RiotName()).ToList();

        return await db.LeagueEntries
            .AsNoTracking()
            .Where(l => l.RiotAccountId == account.Id && ladders.Contains(l.QueueType))
            .OrderBy(l => l.QueueType)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// The same for TFT: tft-league-v1, with the TFT client and the account's
    /// puuid under TFT's key — which is the main one unless the server has a
    /// TFT key of its own.
    ///
    /// Hyper Roll comes back rated, with a colour and a rating where the others
    /// have tier, division and LP, and is stored and read the same way.
    /// </summary>
    public async Task RefreshTftFromRiotAsync(
        RiotAccount account,
        string tftPuuid,
        RiotRequestPriority priority,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(account);

        var entries = await tft.Client.GetTftLeagueEntriesAsync(
            account.Platform, tftPuuid, priority, cancellationToken);

        var now = time.GetUtcNow();

        foreach (var entry in entries.Where(e => RankedQueues.FromRiotName(e.QueueType, Game.Tft) is not null))
        {
            var tier = RankTiers.FromRiotName(entry.Tier);
            var division = RankDivisions.FromRiotName(entry.Division);
            var ratedTier = RatedTiers.FromRiotName(entry.RatedTier);

            var existing = await db.LeagueEntries.FirstOrDefaultAsync(
                l => l.RiotAccountId == account.Id && l.QueueType == entry.QueueType,
                cancellationToken);

            if (existing is null)
            {
                existing = new LeagueEntry { RiotAccountId = account.Id, QueueType = entry.QueueType };
                db.LeagueEntries.Add(existing);
            }

            existing.Tier = tier;
            existing.Division = division;
            existing.LeaguePoints = entry.LeaguePoints;
            existing.Wins = entry.Wins;
            existing.Losses = entry.Losses;
            existing.RatedTier = ratedTier;
            existing.RatedRating = entry.RatedRating;
            existing.FetchedAt = now;

            await RecordAsync(
                account.Id,
                new RankReadingInput(
                    entry.QueueType, tier, division, entry.LeaguePoints, entry.Wins, entry.Losses,
                    ratedTier, entry.RatedRating),
                RankSources.LeagueV4,
                now.ToUnixTimeMilliseconds(),
                force: false,
                cancellationToken);
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Appends a reading when the value actually moved.
    ///
    /// Unchanged readings are dropped rather than stored, because the series is
    /// walked in adjacent pairs: a row identical to the one before it adds an
    /// interval that can never be attributed and splits one that could have been.
    /// Refreshing rank every few minutes for a week would otherwise bury the
    /// handful of readings that mean something under thousands that do not.
    ///
    /// <paramref name="force"/> writes the row anyway. A game that moved no LP
    /// still happened, and without a reading on each side of it the game before
    /// and the game after share one interval and neither can be attributed.
    ///
    /// Returns whether a row was written.
    /// </summary>
    public async Task<bool> RecordAsync(
        Guid riotAccountId,
        RankReadingInput input,
        string source,
        long capturedAtMs,
        bool force = false,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);

        var previous = await LatestAsync(riotAccountId, input.QueueType, cancellationToken);

        if (!force
            && previous is not null
            && previous.Tier == input.Tier
            && previous.Division == input.Division
            && previous.LeaguePoints == input.LeaguePoints
            && previous.RatedTier == input.RatedTier
            && previous.RatedRating == input.RatedRating)
        {
            return false;
        }

        db.RankSnapshots.Add(new RankSnapshot
        {
            RiotAccountId = riotAccountId,
            QueueType = input.QueueType,
            Tier = input.Tier,
            Division = input.Division,
            LeaguePoints = input.LeaguePoints,
            Wins = input.Wins,
            Losses = input.Losses,

            // Stamped on write so a graph never has to recompute it, and so the
            // row keeps the answer the ladder maths gave at the time.
            // On a rated ladder, the rating.
            LadderPosition = RankedQueues.FromRiotName(input.QueueType) is { } queue
                ? Ladders.PositionOf(queue, new Rank(input.Tier, input.Division, input.LeaguePoints), input.RatedRating)
                : Ladder.LadderPosition(new Rank(input.Tier, input.Division, input.LeaguePoints)),
            RatedTier = input.RatedTier,
            RatedRating = input.RatedRating,

            Source = source,
            CapturedAt = capturedAtMs
        });

        return true;
    }

    private Task<RankSnapshot?> LatestAsync(Guid riotAccountId, string queueType, CancellationToken cancellationToken)
    {
        // Includes anything staged but not yet saved, because a refresh records
        // both ladders before saving and the second must see the first.
        var pending = db.ChangeTracker.Entries<RankSnapshot>()
            .Where(e => e.State == EntityState.Added
                && e.Entity.RiotAccountId == riotAccountId
                && e.Entity.QueueType == queueType)
            .Select(e => e.Entity)
            .OrderByDescending(r => r.CapturedAt)
            .FirstOrDefault();

        if (pending is not null) return Task.FromResult<RankSnapshot?>(pending);

        return db.RankSnapshots
            .AsNoTracking()
            .Where(r => r.RiotAccountId == riotAccountId && r.QueueType == queueType)
            .OrderByDescending(r => r.CapturedAt)
            .ThenByDescending(r => r.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }
}
