using Foxfire.Api.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Services;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Sync;

/// <summary>What a sweep did with one account's history of one game.</summary>
public enum BackgroundSyncOutcome
{
    /// <summary>Synced, whether or not anything new turned up.</summary>
    Synced,

    /// <summary>Synced too recently to be worth asking Riot again.</summary>
    Fresh,

    /// <summary>A sync of it was already under way, or a post-game ladder is waiting on it.</summary>
    Busy,

    /// <summary>The sync failed. It said so itself, in the log and on its progress event.</summary>
    Failed,

    /// <summary>Riot refused the key, so every sync after it would fail the same way.</summary>
    KeyRejected
}

/// <summary>
/// Syncing every tracked account by itself, on a timer, when an admin has
/// turned it on.
///
/// Everything else that syncs is asked to: a desktop that saw a game end, a
/// member pressing Sync now, another member's sync finding them in a game. An
/// owner who is not running Foxfire asks for nothing, and an account an admin
/// added has nobody to ask — so their rank readings stopped, and the LP graph
/// drew a straight line across everything they played in between. This is what
/// keeps those graphs true.
///
/// Every minute it reads the switches, and when a sweep is due it works through
/// every account's League and TFT history, stalest first, one at a time. It
/// leaves alone anybody synced inside the skip window, anybody whose sync is
/// under way, and anybody a post-game ladder is waiting on — they are being
/// kept current already. Each sync is an ordinary run, triggered as
/// <see cref="SyncTrigger.Background"/>, so its requests wait behind every
/// search and every post-game ladder in Riot's queue.
///
/// One process sweeps at a time (<see cref="SqlAppLock"/>), and a sweep that
/// runs longer than the interval delays the next rather than overlapping it.
/// The time of the last sweep is this process's own: a restart sweeps within a
/// minute, and the skip window is what keeps that from asking Riot twice.
/// </summary>
public sealed class BackgroundSyncs(
    IServiceScopeFactory scopes,
    SyncService sync,
    PostGameSyncScheduler ladders,
    TftAccess tftAccess,
    RiotRateLimiter limiter,
    TimeProvider time,
    IOptions<SyncOptions> options,
    ILogger<BackgroundSyncs> log) : BackgroundService
{
    /// <summary>How often it looks at the switches — so turning it on starts a sweep within this.</summary>
    public static readonly TimeSpan Tick = TimeSpan.FromMinutes(1);

    private const string LockResource = "foxfire.sync.background";

    private DateTimeOffset? _lastSweep;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Background)
        {
            log.LogInformation("Background sync does not run in this process, because Sync__Background is false");
            return;
        }

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(Tick, time, stoppingToken);

                try
                {
                    await RunIfDueAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // A background service that throws takes the host with it,
                    // and a sweep is not worth the server. The next tick tries again.
                    log.LogWarning(ex, "Background sync could not sweep this time; it will try again");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down. A sync the sweep was waiting on finishes or dies
            // with the process, and the next sweep picks up wherever this left off.
        }
    }

    /// <summary>
    /// One look at the switches and the clock, sweeping if it is on and due.
    /// True when this process swept.
    /// </summary>
    public async Task<bool> RunIfDueAsync(CancellationToken cancellationToken)
    {
        BackgroundSyncSettings settings;
        using (var scope = scopes.CreateScope())
        {
            settings = await scope.ServiceProvider.GetRequiredService<ServerSettingsService>()
                .GetBackgroundSyncAsync(cancellationToken);
        }

        if (!settings.Enabled)
        {
            // So that turning it back on sweeps at the next tick rather than
            // an interval after whenever the last sweep was.
            _lastSweep = null;
            return false;
        }

        var now = time.GetUtcNow();
        if (!BackgroundSyncRules.IsSweepDue(_lastSweep, now, settings.Interval)) return false;

        // Every sync would fail the same way. The rejection has already been
        // logged and pushed to every client, and only a restart clears it.
        if (limiter.KeyRejected) return false;

        _lastSweep = now;

        using var lockScope = scopes.CreateScope();
        var db = lockScope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        await db.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            var connection = db.Database.GetDbConnection();
            if (!await SqlAppLock.TryTakeAsync(connection, LockResource, cancellationToken))
            {
                log.LogDebug("Another process is sweeping; this one waits for the next interval");
                return false;
            }

            try
            {
                await SweepAsync(settings.Skip, cancellationToken);
                return true;
            }
            finally
            {
                await SqlAppLock.ReleaseAsync(connection, LockResource, log);
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    /// <summary>One sweep: every history that is due, stalest first, one at a time.</summary>
    public async Task SweepAsync(TimeSpan skip, CancellationToken cancellationToken)
    {
        var startedAt = time.GetUtcNow();
        var started = time.GetTimestamp();

        using var _ = log.BeginScope(new Dictionary<string, object> { ["BackgroundSweep"] = startedAt });

        var due = await DueAsync(startedAt, skip, cancellationToken);
        log.LogInformation("Background sync started: {Count} account histories are due", due.Count);

        var synced = 0;
        var leftAlone = 0;
        var failed = 0;
        var tftRefused = false;

        foreach (var candidate in due)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (!await IsStillOnAsync(cancellationToken))
            {
                log.LogInformation("Background sync was turned off part-way through a sweep, so it stopped");
                break;
            }

            // A League-only key is a healthy server, and TftAccess has already
            // said so once. Asking again for every account would be a refusal
            // per account per sweep, announced to every client.
            if (candidate.Game == Game.Tft && (tftRefused || tftAccess.State == TftAccessState.Denied))
            {
                leftAlone++;
                continue;
            }

            var stop = false;

            switch (await SyncIfDueAsync(candidate.RiotAccountId, candidate.Game, skip, cancellationToken))
            {
                case BackgroundSyncOutcome.Synced:
                    synced++;
                    break;
                case BackgroundSyncOutcome.Fresh or BackgroundSyncOutcome.Busy:
                    leftAlone++;
                    break;
                case BackgroundSyncOutcome.KeyRejected when candidate.Game == Game.Tft:
                    // Possibly TFT's own key, when the server has one, with
                    // League's still fine. If it was the main key, the next
                    // League sync finds out.
                    tftRefused = true;
                    failed++;
                    break;
                case BackgroundSyncOutcome.KeyRejected:
                    failed++;
                    stop = true;
                    break;
                default:
                    failed++;
                    break;
            }

            if (stop)
            {
                log.LogWarning("Background sync stopped part-way: Riot has refused this server's key");
                break;
            }
        }

        log.LogInformation(
            "Background sync finished in {Elapsed}: {Synced} synced, {LeftAlone} left alone, {Failed} failed",
            time.GetElapsedTime(started),
            synced,
            leftAlone,
            failed);
    }

    /// <summary>
    /// Every account's history of every game that has not been synced inside
    /// the skip window, in the order a sweep works through them — see
    /// <see cref="BackgroundSyncRules.Order"/>. One that has never been synced
    /// at all is here too, last.
    /// </summary>
    public async Task<IReadOnlyList<BackgroundSyncCandidate>> DueAsync(
        DateTimeOffset now,
        TimeSpan skip,
        CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        // Every account on the server, which a read for a client never is. This
        // is the server's own work over its own community, and it is the ids
        // and two timestamps a history, not the accounts.
        var accounts = await db.RiotAccounts.AsNoTracking()
            .Select(a => a.Id)
            .ToListAsync(cancellationToken);

        var states = await db.SyncStates.AsNoTracking()
            .Select(s => new { s.RiotAccountId, s.Game, s.LastFullSyncAt, s.LastDeltaSyncAt })
            .ToListAsync(cancellationToken);

        var lastSynced = states.ToDictionary(
            s => (s.RiotAccountId, s.Game),
            s => LastSynced(s.LastFullSyncAt, s.LastDeltaSyncAt));

        return BackgroundSyncRules.Order(
            from id in accounts
            from game in Games.All
            let last = lastSynced.GetValueOrDefault((id, game))
            where !BackgroundSyncRules.IsFresh(last, now, skip)
            select new BackgroundSyncCandidate(id, game, last));
    }

    /// <summary>
    /// Syncs one account's history of one game, unless something else has it
    /// in hand or it was synced inside <paramref name="skip"/>.
    ///
    /// Looks again rather than trusting the list the sweep started from: a
    /// sweep takes minutes, and in that time a post-game ladder or a
    /// co-player's sync may have done this one already.
    /// </summary>
    public async Task<BackgroundSyncOutcome> SyncIfDueAsync(
        Guid riotAccountId,
        Game game,
        TimeSpan skip,
        CancellationToken cancellationToken)
    {
        if (sync.IsSyncing(riotAccountId, game) || ladders.IsScheduled(riotAccountId, game))
        {
            return BackgroundSyncOutcome.Busy;
        }

        DateTimeOffset? last;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
            var state = await db.SyncStates.AsNoTracking()
                .Where(s => s.RiotAccountId == riotAccountId && s.Game == game)
                .Select(s => new { s.LastFullSyncAt, s.LastDeltaSyncAt })
                .FirstOrDefaultAsync(cancellationToken);

            last = state is null ? null : LastSynced(state.LastFullSyncAt, state.LastDeltaSyncAt);
        }

        if (BackgroundSyncRules.IsFresh(last, time.GetUtcNow(), skip)) return BackgroundSyncOutcome.Fresh;

        try
        {
            await sync.SyncAsync(riotAccountId, game, SyncTrigger.Background, cancellationToken);
            return BackgroundSyncOutcome.Synced;
        }
        catch (RiotApiException ex) when (ex.IsKeyRejection)
        {
            return BackgroundSyncOutcome.KeyRejected;
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            // Logged and announced by the run itself. One account's failure is
            // no reason to leave everybody after it unsynced.
            return BackgroundSyncOutcome.Failed;
        }
    }

    private async Task<bool> IsStillOnAsync(CancellationToken cancellationToken)
    {
        using var scope = scopes.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ServerSettingsService>()
            .IsBackgroundSyncEnabledAsync(cancellationToken);
    }

    /// <summary>The later of the two, as <see cref="SyncCooldown"/> reads them.</summary>
    private static DateTimeOffset? LastSynced(DateTimeOffset? full, DateTimeOffset? delta) =>
        new[] { full, delta }.Max();
}
