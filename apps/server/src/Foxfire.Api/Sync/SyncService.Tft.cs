using Foxfire.Api.Services;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Sync;

/// <summary>A TFT sync: the same run as League's, through TFT's client and onto TFT's tables.</summary>
public sealed partial class SyncService
{
    /// <summary>
    /// Fetches an account's TFT games and everything that follows from having them.
    ///
    /// Step for step the League run — ids, the ones not yet stored, each fetched
    /// and committed as it arrives, then a reading, attribution and co-players —
    /// with three differences. It goes through <see cref="TftRiot"/>, so it uses
    /// TFT's key when the server has one; it files games under the account's TFT
    /// puuid, which is a different string under that key; and it does not start
    /// at all while Riot has said this server's key has no TFT, beyond asking
    /// again once that answer is ten minutes old.
    ///
    /// A key with no TFT is not a failed sync. A League-only server is a healthy
    /// one, and <see cref="TftAccess"/> has already said so once, as a warning:
    /// the run completes with nothing fetched and the reason on its event, where
    /// a throw would be an Error line for every account at every launch.
    /// </summary>
    private async Task<SyncResult> RunTftAsync(Guid riotAccountId, SyncTrigger trigger, SyncRunProgress run)
    {
        using var scope = scopes.CreateScope();
        var services = scope.ServiceProvider;

        var db = services.GetRequiredService<FoxfireDbContext>();
        var tft = services.GetRequiredService<TftRiot>();
        var access = services.GetRequiredService<TftAccess>();
        var identity = services.GetRequiredService<TftIdentity>();
        var ingestion = services.GetRequiredService<MatchIngestion>();
        var tftIngestion = services.GetRequiredService<TftMatchIngestion>();
        var ranks = services.GetRequiredService<RankRecorder>();
        var attribution = services.GetRequiredService<AttributionRunner>();
        var settings = services.GetRequiredService<ServerSettingsService>();

        if (!access.MayReprobe) return await NoTftAccessAsync(riotAccountId, trigger);

        var account = await db.RiotAccounts.FirstOrDefaultAsync(a => a.Id == riotAccountId)
            ?? throw new InvalidOperationException($"Unknown Riot account {riotAccountId}");

        var state = await EnsureSyncStateAsync(db, settings, riotAccountId, Game.Tft);
        var isBackfill = !state.BackfillComplete;
        var phase = isBackfill ? SyncPhase.Backfill : SyncPhase.Delta;

        run.Kind = isBackfill ? "backfill" : "delta";
        run.RiotId = account.RiotId;

        var priority = isBackfill
            ? RiotRequestPriority.Backfill
            : trigger == SyncTrigger.Manual
                ? RiotRequestPriority.Interactive
                : RiotRequestPriority.PostGame;

        log.LogInformation("TFT sync started for {RiotId} ({Phase}, {Trigger})", account.RiotId, phase, trigger);

        await events.SyncProgressAsync(new SyncProgressEvent(
            riotAccountId, phase, 0, 0, "Fetching TFT match list…", trigger, Game: Game.Tft.Slug()));

        var target = isBackfill ? state.BackfillTarget : RiotClient.TftMatchIdsPageSize;

        IReadOnlyList<string> allIds;
        string puuid;

        try
        {
            puuid = await identity.PuuidAsync(account, priority);
            (allIds, puuid) = await FetchTftMatchIdsRepairingIdentityAsync(db, tft, identity, account, puuid, target, priority);
            access.Grant();
        }
        catch (RiotApiException ex) when (ex.NoProductAccess || (tft.HasOwnKey && ex.IsKeyRejection))
        {
            access.Deny(ex.NoProductAccess
                ? "This server's Riot key has no TFT access. Set Riot__Tft__ApiKey to a key registered for TFT."
                : "Riot rejected this server's TFT key.");

            // A TFT key of its own that Riot refused is a broken key, which is
            // a failure; the main key simply not reaching TFT is not.
            if (ex.NoProductAccess) return await NoTftAccessAsync(riotAccountId, trigger);
            throw;
        }

        var candidates = isBackfill ? allIds : SyncPlanning.SelectNewMatchIds(allIds, state.MostRecentMatchId);
        var idsToFetch = await ingestion.FilterUnstoredAsync(candidates);
        var newest = allIds.Count > 0 ? allIds[0] : null;

        var failed = 0;
        var total = idsToFetch.Count;

        for (var i = 0; i < idsToFetch.Count; i++)
        {
            var matchId = idsToFetch[i];

            try
            {
                var raw = await tft.Client.GetTftMatchAsync(account.RegionalRoute, matchId, priority);
                await tftIngestion.StoreAsync(raw);
            }
            catch (RiotApiException ex) when (ex.IsKeyRejection || ex.NoProductAccess)
            {
                throw;
            }
            catch (Exception ex)
            {
                failed++;
                log.LogError(ex, "Failed to sync TFT match {MatchId} for {RiotId}", matchId, account.RiotId);
            }

            await events.SyncProgressAsync(new SyncProgressEvent(
                account.Id, phase, i + 1, total, null, trigger, Game: Game.Tft.Slug()));
        }

        var stored = total - failed;
        run.Stored = stored;
        run.Failed = failed;

        // After the games, for the reason the League run gives: a reading taken
        // first would close an interval before the game inside it existed.
        try
        {
            await ranks.RefreshTftFromRiotAsync(account, puuid, priority);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "TFT rank reading failed after syncing {RiotId}", account.RiotId);
        }

        try
        {
            var since = time.GetUtcNow().ToUnixTimeMilliseconds() - AttributionRunner.ReplayWindowMs;
            var attributed = await attribution.ReplayAsync(riotAccountId, Game.Tft, puuid, since);
            if (attributed > 0) log.LogDebug("Attributed LP to {Count} TFT game(s)", attributed);
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "TFT LP attribution replay failed for {RiotAccountId}", riotAccountId);
        }

        if (!isBackfill && stored > 0)
        {
            try
            {
                var coPlayers = services.GetRequiredService<CoPlayerRanks>();
                var read = await coPlayers.ReadAsync(
                    Game.Tft, account.Id, idsToFetch, id => IsSyncing(id, Game.Tft), priority);
                if (read > 0) log.LogDebug("Read TFT rank for {Count} co-player(s) of {RiotId}", read, account.RiotId);
            }
            catch (Exception ex)
            {
                log.LogDebug(ex, "Reading TFT co-players' rank failed after syncing {RiotId}", account.RiotId);
            }
        }

        if (failed == 0) await MarkSyncedAsync(db, state, isBackfill, newest);

        log.LogInformation(
            "TFT sync finished for {RiotId}: {Stored} stored, {Failed} failed", account.RiotId, stored, failed);

        await events.SyncProgressAsync(new SyncProgressEvent(
            riotAccountId,
            SyncPhase.Complete,
            stored,
            total,
            failed > 0 ? $"{failed} match{(failed == 1 ? "" : "es")} failed — syncing again will fill the gaps" : null,
            trigger,
            SyncCooldown.Until(state),
            Game.Tft.Slug()));

        return new SyncResult(stored, failed);
    }

    /// <summary>What a member is told about a TFT sync on a key with no TFT.</summary>
    internal const string NoTftAccessMessage =
        "This server's Riot key has no TFT access. Its administrator can add a TFT key.";

    /// <summary>A TFT sync that had nothing it could fetch: complete, empty, and saying why.</summary>
    private async Task<SyncResult> NoTftAccessAsync(Guid riotAccountId, SyncTrigger trigger)
    {
        log.LogDebug("TFT sync skipped for {RiotAccountId}: this server's Riot key has no TFT", riotAccountId);

        await events.SyncProgressAsync(new SyncProgressEvent(
            riotAccountId, SyncPhase.Complete, 0, 0, NoTftAccessMessage, trigger, Game: Game.Tft.Slug()));

        return new SyncResult(0, 0);
    }

    /// <summary>The TFT id list and the puuid that fetched it, re-resolving once on a dead puuid.</summary>
    private async Task<(IReadOnlyList<string> Ids, string Puuid)> FetchTftMatchIdsRepairingIdentityAsync(
        FoxfireDbContext db,
        TftRiot tft,
        TftIdentity identity,
        RiotAccount account,
        string puuid,
        int target,
        RiotRequestPriority priority)
    {
        try
        {
            return (await FetchTftMatchIdsAsync(tft, account, puuid, target, priority), puuid);
        }
        catch (RiotApiException ex) when (ex.StaleIdentity)
        {
            log.LogInformation(
                "Riot rejected the stored TFT id for {RiotId}; re-resolving from the Riot ID", account.RiotId);

            var outcome = await identity.RepairAsync(account);
            var plan = SyncPlanning.AfterIdentityRepair(outcome, account.RiotId);
            if (!plan.Retry) throw new InvalidOperationException(plan.Message);

            // Read again rather than trusted from before: the repair moved it.
            var fresh = await db.RiotAccounts.AsNoTracking().FirstAsync(a => a.Id == account.Id);
            var repaired = await identity.PuuidAsync(fresh, priority);

            return (await FetchTftMatchIdsAsync(tft, account, repaired, target, priority), repaired);
        }
    }

    private static async Task<IReadOnlyList<string>> FetchTftMatchIdsAsync(
        TftRiot tft,
        RiotAccount account,
        string puuid,
        int target,
        RiotRequestPriority priority)
    {
        List<string> ids = [];

        foreach (var count in SyncPlanning.PlanMatchIdPages(target, RiotClient.TftMatchIdsPageSize))
        {
            var page = await tft.Client.GetTftMatchIdsAsync(account.RegionalRoute, puuid, ids.Count, count, priority);
            ids.AddRange(page);
            if (page.Count < count) break;
        }

        return ids;
    }
}
