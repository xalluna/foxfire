using Foxfire.Api.Services;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>What a sync run did.</summary>
/// <param name="Stored">Matches newly written by this run.</param>
/// <param name="Failed">Matches this run could not fetch. Retried on the next pass.</param>
public sealed record SyncResult(int Stored, int Failed);

/// <summary>
/// Fetching an account's games and everything that follows from having them.
///
/// A port of the desktop's syncService, and structurally the same run: get the
/// id list, work out which are new, fetch each through the shared limiter,
/// commit as they arrive, then take a rank reading and replay attribution. The
/// order matters at one point in particular and is commented where it does.
///
/// Three things differ because this is a server.
///
/// It runs on its own scope rather than a request's. A sync outlives the HTTP
/// call that asked for it — a backfill is minutes — and progress goes out over
/// SignalR rather than as a response, so holding the request's DbContext would
/// mean a disposed context halfway through.
///
/// Priority is chosen per phase. One personal key is the whole server's
/// allowance, so a first-time backfill of two hundred matches goes in the
/// background class no matter who asked for it: the alternative is one person
/// linking an account and everybody else's searches stopping for ten minutes.
/// The progress bar is what makes that acceptable to the person waiting.
///
/// A run is joined rather than dropped. Two people in the same game both signal
/// game-end, or somebody presses sync while the ladder is already retrying; the
/// second caller gets the first run's result, which is the honest answer to "did
/// anything land".
/// </summary>
public sealed class SyncService(
    IServiceScopeFactory scopes,
    IServerEvents events,
    ILogger<SyncService> log)
{
    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, Task<SyncResult>> _inFlight = [];

    /// <summary>Whether a run is under way for this account.</summary>
    public bool IsSyncing(Guid riotAccountId)
    {
        lock (_gate) return _inFlight.ContainsKey(riotAccountId);
    }

    /// <summary>
    /// Syncs an account, joining a run already under way rather than starting a
    /// second one.
    ///
    /// The cancellation token belongs to the *caller*, not to the run. A run
    /// started by a request that the client then abandons should still finish —
    /// its matches are as wanted as they were a second earlier — so the token is
    /// used for the join and not passed down.
    /// </summary>
    public Task<SyncResult> SyncAsync(
        Guid riotAccountId,
        SyncTrigger trigger,
        CancellationToken cancellationToken = default)
    {
        Task<SyncResult> run;

        lock (_gate)
        {
            if (_inFlight.TryGetValue(riotAccountId, out var running)) return running;

            run = Task.Run(() => RunGuardedAsync(riotAccountId, trigger), CancellationToken.None);
            _inFlight[riotAccountId] = run;
        }

        // Registered after the add, so the entry can never be cleared before it
        // was there to clear. The swallowed rejection only keeps this bookkeeping
        // from surfacing as an unobserved exception — the returned task still
        // faults for the caller.
        _ = run.ContinueWith(
            _ =>
            {
                lock (_gate) _inFlight.Remove(riotAccountId);
            },
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        return run.WaitAsync(cancellationToken);
    }

    private async Task<SyncResult> RunGuardedAsync(Guid riotAccountId, SyncTrigger trigger)
    {
        // On every line the run writes, from here down through the Riot client
        // and the ingestion it calls — so a sync can be followed on its own, and
        // one that failed can be told apart from the five running beside it.
        using var _ = log.BeginScope(new Dictionary<string, object>
        {
            ["RiotAccountId"] = riotAccountId,
            ["SyncTrigger"] = trigger
        });

        try
        {
            return await RunAsync(riotAccountId, trigger);
        }
        catch (Exception ex)
        {
            log.LogError(ex, "Sync failed for Riot account {RiotAccountId}", riotAccountId);

            await events.SyncProgressAsync(new SyncProgressEvent(
                riotAccountId, SyncPhase.Error, 0, 0, Describe(ex), trigger));

            throw;
        }
    }

    /// <summary>
    /// What a member should be told when a sync fails.
    ///
    /// A Riot failure is reported as itself — a rejected key is the host's
    /// problem and saying so is more use than "sync failed". Anything else is
    /// this server's bug, and its exception text is for the log rather than for
    /// somebody's screen.
    /// </summary>
    private static string Describe(Exception ex) => ex switch
    {
        RiotApiException { IsKeyRejection: true } =>
            "This server's Riot API key is not working. Its administrator needs to replace it.",
        RiotApiException { Status: 429 } =>
            "Riot is rate limiting this server. Syncing again shortly should work.",
        RiotApiException riot => riot.Message,
        InvalidOperationException invalid => invalid.Message,
        _ => "Sync failed."
    };

    private async Task<SyncResult> RunAsync(Guid riotAccountId, SyncTrigger trigger)
    {
        using var scope = scopes.CreateScope();
        var services = scope.ServiceProvider;

        var db = services.GetRequiredService<FoxfireDbContext>();
        var riot = services.GetRequiredService<RiotClient>();
        var ingestion = services.GetRequiredService<MatchIngestion>();
        var ranks = services.GetRequiredService<RankRecorder>();
        var profile = services.GetRequiredService<AccountProfile>();
        var attribution = services.GetRequiredService<AttributionRunner>();
        var identity = services.GetRequiredService<IdentityRepair>();
        var settings = services.GetRequiredService<ServerSettingsService>();

        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == riotAccountId)
            ?? throw new InvalidOperationException($"Unknown Riot account {riotAccountId}");

        var state = await EnsureSyncStateAsync(db, settings, riotAccountId);
        var isBackfill = !state.BackfillComplete;
        var phase = isBackfill ? SyncPhase.Backfill : SyncPhase.Delta;

        // A backfill is background work however it was triggered: two hundred
        // requests out of a hundred every two minutes is the whole server's
        // budget for four minutes, and nobody else's search should stop for it.
        var priority = isBackfill
            ? RiotRequestPriority.Backfill
            : trigger == SyncTrigger.Manual
                ? RiotRequestPriority.Interactive
                : RiotRequestPriority.PostGame;

        log.LogInformation(
            "Sync started for {RiotId} ({Phase}, {Trigger})", account.RiotId, phase, trigger);

        await events.SyncProgressAsync(new SyncProgressEvent(
            riotAccountId, phase, 0, 0, "Fetching match list…", trigger));

        var target = isBackfill ? state.BackfillTarget : RiotClient.MatchIdsPageSize;
        var (allIds, puuid) = await FetchMatchIdsRepairingIdentityAsync(
            db, riot, identity, account, target, priority);

        var candidates = isBackfill
            ? allIds
            : SyncPlanning.SelectNewMatchIds(allIds, state.MostRecentMatchId);

        var idsToFetch = await ingestion.FilterUnstoredAsync(candidates);
        var newest = allIds.Count > 0 ? allIds[0] : null;

        var failed = 0;

        if (idsToFetch.Count > 0)
        {
            failed = await FetchAndStoreAsync(
                riot, ingestion, account, idsToFetch, phase, trigger, priority);
        }

        var stored = idsToFetch.Count - failed;

        // Deliberately after the matches are stored. Attribution looks for games
        // falling between two readings, so a reading taken first would find an
        // empty interval and leave everything that just arrived unattributed —
        // and because a reading moves the boundary past those games, nothing
        // would ever come back for them.
        await SnapshotRankAsync(ranks, account, priority);
        await RefreshProfileAsync(profile, account, priority);
        await ReplayAttributionAsync(attribution, riotAccountId, puuid);

        // Only advance the marker when everything landed. Leaving it alone on a
        // partial failure means the next run retries just the gaps, and already
        // stored ids are filtered out, so the retry is cheap.
        if (failed == 0) await MarkSyncedAsync(db, state, isBackfill, newest);

        log.LogInformation(
            "Sync finished for {RiotId}: {Stored} stored, {Failed} failed", account.RiotId, stored, failed);

        // Read off the row after it was marked, so a run that left gaps — and
        // did not mark it — reports the wait the server will actually enforce.
        await events.SyncProgressAsync(new SyncProgressEvent(
            riotAccountId,
            SyncPhase.Complete,
            stored,
            idsToFetch.Count,
            failed > 0 ? $"{failed} match{(failed == 1 ? "" : "es")} failed — syncing again will fill the gaps" : null,
            trigger,
            SyncCooldown.Until(state)));

        return new SyncResult(stored, failed);
    }

    /// <summary>
    /// The id list, and the puuid that fetched it.
    ///
    /// A key rotation looks like exactly one thing from in here: Riot answers 400
    /// for a puuid it cannot decrypt, because that puuid was encrypted under a
    /// key this server no longer holds. Nothing is wrong with the account and
    /// nothing is wrong with its history, so the run re-resolves it from the Riot
    /// ID and asks again rather than failing in front of somebody with a bare 400.
    ///
    /// Once. A second failure is not the same failure, and a repair reporting
    /// anything but a moved puuid says the retry would fail identically.
    ///
    /// Returns the puuid because the rest of the run needs the current one —
    /// attribution reads back the very rows the repair just rewrote.
    /// </summary>
    private async Task<(IReadOnlyList<string> Ids, string Puuid)> FetchMatchIdsRepairingIdentityAsync(
        FoxfireDbContext db,
        RiotClient riot,
        IdentityRepair identity,
        RiotAccount account,
        int target,
        RiotRequestPriority priority)
    {
        try
        {
            return (await FetchMatchIdsAsync(riot, account, account.Puuid, target, priority), account.Puuid);
        }
        catch (RiotApiException ex) when (ex.StaleIdentity)
        {
            log.LogInformation(
                "Riot rejected the stored puuid for {RiotId}; re-resolving from the Riot ID", account.RiotId);

            var outcome = await identity.RepairAsync(account.Id);
            var plan = SyncPlanning.AfterIdentityRepair(outcome, account.RiotId);
            if (!plan.Retry) throw new InvalidOperationException(plan.Message);

            var repaired = await db.RiotAccounts.AsNoTracking()
                .Where(a => a.Id == account.Id)
                .Select(a => a.Puuid)
                .FirstAsync();

            return (await FetchMatchIdsAsync(riot, account, repaired, target, priority), repaired);
        }
    }

    /// <summary>Collects up to <paramref name="target"/> ids, paging at Riot's maximum.</summary>
    private static async Task<IReadOnlyList<string>> FetchMatchIdsAsync(
        RiotClient riot,
        RiotAccount account,
        string puuid,
        int target,
        RiotRequestPriority priority)
    {
        List<string> ids = [];

        foreach (var count in SyncPlanning.PlanMatchIdPages(target, RiotClient.MatchIdsPageSize))
        {
            var page = await riot.GetMatchIdsAsync(
                account.RegionalRoute, puuid, ids.Count, count, priority);

            ids.AddRange(page);

            // Reached the end of this player's history.
            if (page.Count < count) break;
        }

        return ids;
    }

    /// <summary>
    /// Fetches each match through the shared limiter and commits it as it
    /// arrives, so an interrupted run resumes where it stopped.
    /// </summary>
    private async Task<int> FetchAndStoreAsync(
        RiotClient riot,
        MatchIngestion ingestion,
        RiotAccount account,
        IReadOnlyList<string> matchIds,
        SyncPhase phase,
        SyncTrigger trigger,
        RiotRequestPriority priority)
    {
        var total = matchIds.Count;
        var current = 0;
        var failed = 0;

        foreach (var matchId in matchIds)
        {
            try
            {
                var raw = await riot.GetMatchAsync(account.RegionalRoute, matchId, priority);
                await ingestion.StoreAsync(raw);
            }
            catch (RiotApiException ex) when (ex.IsKeyRejection)
            {
                // A rejected key fails every remaining match the same way, so
                // stop rather than grinding through the rest to report a hollow
                // success.
                throw;
            }
            catch (Exception ex)
            {
                // One bad match should not abort an otherwise healthy run.
                failed++;
                log.LogError(ex, "Failed to sync match {MatchId} for {RiotId}", matchId, account.RiotId);
            }

            current++;
            await events.SyncProgressAsync(new SyncProgressEvent(
                account.Id, phase, current, total, null, trigger));
        }

        return failed;
    }

    /// <summary>
    /// Records where the ladder stands at the end of a run.
    ///
    /// Never fails the sync. The matches are already committed by this point, and
    /// a rank call that 404s on an unranked account or trips the limiter must not
    /// turn a successful import into an error.
    /// </summary>
    private async Task SnapshotRankAsync(RankRecorder ranks, RiotAccount account, RiotRequestPriority priority)
    {
        try
        {
            await ranks.RefreshFromRiotAsync(account, priority);
        }
        catch (Exception ex)
        {
            // Logged rather than truly silent: a rank call failing on every
            // single sync is a real problem that would otherwise never surface.
            log.LogDebug(ex, "Rank reading failed after syncing {RiotId}", account.RiotId);
        }
    }

    /// <summary>
    /// Brings the icon and level into line, on the same terms as the reading
    /// above: one extra request on a run that already made dozens, and a
    /// failure costs a stale icon rather than the sync.
    /// </summary>
    private async Task RefreshProfileAsync(
        AccountProfile profile,
        RiotAccount account,
        RiotRequestPriority priority)
    {
        try
        {
            await profile.RefreshAsync(account, priority);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Profile refresh failed after syncing {RiotId}", account.RiotId);
        }
    }

    /// <summary>
    /// Closes any interval whose match has since arrived. Pure database work, and
    /// best-effort for the same reason as the reading above.
    /// </summary>
    private async Task ReplayAttributionAsync(AttributionRunner attribution, Guid riotAccountId, string puuid)
    {
        try
        {
            var since = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - AttributionRunner.ReplayWindowMs;
            var attributed = await attribution.ReplayAsync(riotAccountId, puuid, since);
            if (attributed > 0) log.LogDebug("Attributed LP to {Count} game(s)", attributed);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "LP attribution replay failed for {RiotAccountId}", riotAccountId);
        }
    }

    private static async Task<SyncState> EnsureSyncStateAsync(
        FoxfireDbContext db,
        ServerSettingsService settings,
        Guid riotAccountId)
    {
        var state = await db.SyncStates.FirstOrDefaultAsync(s => s.RiotAccountId == riotAccountId);
        if (state is not null) return state;

        state = new SyncState
        {
            RiotAccountId = riotAccountId,

            // Copied onto the row rather than read live, so an admin lowering the
            // server-wide figure cannot retroactively declare a half-finished
            // backfill complete.
            BackfillTarget = await settings.GetBackfillTargetAsync()
        };

        db.SyncStates.Add(state);

        try
        {
            await db.SaveChangesAsync();
            return state;
        }
        catch (DbUpdateException)
        {
            // Another run created it first.
            db.Entry(state).State = EntityState.Detached;
            return await db.SyncStates.FirstAsync(s => s.RiotAccountId == riotAccountId);
        }
    }

    private static async Task MarkSyncedAsync(
        FoxfireDbContext db,
        SyncState state,
        bool isBackfill,
        string? newestMatchId)
    {
        var now = DateTimeOffset.UtcNow;

        if (isBackfill)
        {
            state.BackfillComplete = true;
            state.LastFullSyncAt = now;
        }

        state.LastDeltaSyncAt = now;

        // Only ever moves forward. A delta that found nothing leaves the marker
        // where it was rather than clearing it.
        if (newestMatchId is not null) state.MostRecentMatchId = newestMatchId;

        await db.SaveChangesAsync();
    }
}
