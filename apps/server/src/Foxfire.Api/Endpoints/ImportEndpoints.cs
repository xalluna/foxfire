using System.Text.Json;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Riot;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Endpoints;

/// <summary>An account out of somebody's stats.db, as that file describes it.</summary>
/// <param name="Puuid">
/// The one the desktop stored, which is dead here and is sent anyway — it is the
/// key every other row in that file is joined on, and the only way to know which
/// imported rows belong to which account.
/// </param>
public sealed record ImportAccount(
    string GameName,
    string TagLine,
    string? Platform,
    string Puuid);

/// <summary>What became of one imported account.</summary>
public sealed record ImportAccountResult(
    string RiotId,
    Guid? AccountId,
    bool Resolved,
    string? Message);

/// <summary>One stored game, as the payload it already is.</summary>
public sealed record ImportMatch(string MatchId, string RawJson);

/// <summary>One rank reading, keyed by the puuid the source file used.</summary>
public sealed record ImportRankReading(
    string Puuid,
    string QueueType,
    string? Tier,
    string? Division,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    string Source,
    long CapturedAt,
    string? MatchId);

/// <summary>One season boundary out of the source file.</summary>
public sealed record ImportSeason(string Label, long StartsAt, bool IsPreseason, bool ResetsRank);

/// <summary>How much of a batch landed.</summary>
public sealed record ImportBatchResult(int Accepted, int Skipped, int Failed);

/// <summary>What the whole import came to.</summary>
public sealed record ImportSummary(int Accounts, int Attributed);

/// <summary>
/// Moving a stats.db into a server.
///
/// Somebody has been running Foxfire on their own PC for a year and now hosts a
/// server for their friends. Everything they have is worth keeping and none of
/// it can simply be copied, because of one thing: Riot encrypts a player id
/// against the API key that asked for it, and the key that wrote that file is
/// not this server's. Every puuid in it is a value Riot will refuse.
///
/// So the import is keyed on the one identity that survives. Accounts go first
/// and are re-resolved from `gameName#tagLine` through account-v1 — which is
/// exactly what the server already does when its own key rotates. The imported
/// puuid is filed as a retired one against the account it resolved to, and that
/// record is what every later batch is translated through: matches arrive as
/// their own payloads and have their ids rewritten on the way in, readings
/// arrive keyed on the dead puuid and are mapped to the account.
///
/// Three things deliberately do not come across.
///
/// Accounts arrive unlinked. The file says which League accounts its owner
/// played; it says nothing about who on this server they are, and the answer on
/// a server is attested by a running League client rather than asserted by an
/// import. Their history is here and they claim it the ordinary way.
///
/// No Foxfire accounts, because there were none — a stats.db has no users, no
/// passwords and no sessions. The import cannot create a member and does not try.
///
/// And no attributed LP. It is derived from the readings, which do come across,
/// so importing it would be importing a stale copy of something this server can
/// work out itself — and does, once, at the end.
/// </summary>
public static class ImportEndpoints
{
    /// <summary>
    /// A page of anything, capped.
    ///
    /// Matches are 100–200 KB each, so a hundred of them is a 20 MB request:
    /// enough that a year of history is a few dozen calls rather than thousands,
    /// and small enough that a failure costs a page rather than the import.
    /// </summary>
    public const int MaxBatch = 100;

    public static void MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/admin/import")
            .WithTags("Import")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        group.MapPost("/accounts", AccountsAsync);
        group.MapPost("/matches", MatchesAsync);
        group.MapPost("/rank-readings", RankReadingsAsync);
        group.MapPost("/seasons", SeasonsAsync);
        group.MapPost("/finish", FinishAsync);
    }

    /// <summary>
    /// Re-resolves each account and records what its old puuid used to mean.
    ///
    /// One Riot request per account, at interactive priority because somebody is
    /// watching an import run. An account that cannot be resolved is reported
    /// and skipped rather than failing the batch: a renamed account is a thing
    /// its owner can fix afterwards, and the other nine should not wait for it.
    /// </summary>
    private static async Task<IResult> AccountsAsync(
        [FromBody] IReadOnlyList<ImportAccount> accounts,
        FoxfireDbContext db,
        RiotClient riot,
        TimeProvider time,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        if (accounts is null || accounts.Count == 0) return Results.Ok(Array.Empty<ImportAccountResult>());
        if (accounts.Count > MaxBatch) return TooBig();

        List<ImportAccountResult> results = [];
        var now = time.GetUtcNow();

        foreach (var incoming in accounts)
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

                    // Unlinked, deliberately. The file says which accounts its
                    // owner played; it does not say who on this server they are,
                    // and that answer is attested by a League client rather than
                    // asserted by an import.
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

        return Results.Ok(results);
    }

    /// <summary>
    /// Stores a page of matches out of their own payloads.
    ///
    /// The payload is all that is needed: it is the same JSON Riot sends, and
    /// the server already knows how to turn one of those into rows. What it is
    /// not is addressed the same way — every id in it belongs to whoever's key
    /// fetched it — so the retired ids recorded by the account batch are
    /// rewritten to the current ones before anything is projected.
    ///
    /// Strangers' ids are left dead, which is the same trade the key-rotation
    /// path makes: nine of the ten players in a match are not members here, no
    /// lookup goes through them, and re-resolving each would cost a Riot request
    /// per player per match.
    /// </summary>
    private static async Task<IResult> MatchesAsync(
        [FromBody] IReadOnlyList<ImportMatch> matches,
        FoxfireDbContext db,
        MatchIngestion ingestion,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        if (matches is null || matches.Count == 0) return Results.Ok(new ImportBatchResult(0, 0, 0));
        if (matches.Count > MaxBatch) return TooBig();

        var rewrites = await PuuidRewritesAsync(db, cancellationToken);

        var ids = matches.Select(m => m.MatchId).ToList();
        var unstored = (await ingestion.FilterUnstoredAsync(ids, cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var accepted = 0;
        var failed = 0;

        foreach (var incoming in matches)
        {
            if (!unstored.Contains(incoming.MatchId)) continue;

            try
            {
                var rawJson = Rewrite(incoming.RawJson, rewrites);
                var parsed = JsonSerializer.Deserialize<MatchDto>(
                    rawJson, new JsonSerializerOptions(JsonSerializerDefaults.Web));

                if (parsed?.Metadata?.MatchId is null || parsed.Info?.Participants is not { Count: > 0 })
                {
                    failed++;
                    continue;
                }

                if (await ingestion.StoreAsync(new RawMatch(parsed, rawJson), cancellationToken)) accepted++;
            }
            catch (JsonException)
            {
                // A payload that will not parse is one row of somebody's old
                // database, not a reason to abandon their history.
                failed++;
            }
        }

        if (failed > 0)
        {
            logger.LogWarning("{Failed} imported match payload(s) could not be read", failed);
        }

        return Results.Ok(new ImportBatchResult(accepted, matches.Count - accepted - failed, failed));
    }

    /// <summary>
    /// Stores a page of rank readings, mapped onto the accounts they belong to.
    ///
    /// Keyed on the puuid the source file used, which is dead — so this is the
    /// batch that most depends on the accounts having gone first. A reading for
    /// an id nothing resolved to is skipped rather than guessed at.
    /// </summary>
    private static async Task<IResult> RankReadingsAsync(
        [FromBody] IReadOnlyList<ImportRankReading> readings,
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        if (readings is null || readings.Count == 0) return Results.Ok(new ImportBatchResult(0, 0, 0));
        if (readings.Count > MaxBatch) return TooBig();

        var owners = await OwnersByPuuidAsync(db, cancellationToken);

        var accepted = 0;
        var skipped = 0;

        foreach (var incoming in readings)
        {
            if (!owners.TryGetValue(incoming.Puuid, out var accountId))
            {
                skipped++;
                continue;
            }

            if (RankedQueues.FromRiotName(incoming.QueueType) is null)
            {
                skipped++;
                continue;
            }

            // One reading per account, queue and instant. An import run twice
            // should not double every point on somebody's graph.
            var already = await db.RankSnapshots.AnyAsync(
                r => r.RiotAccountId == accountId
                    && r.QueueType == incoming.QueueType
                    && r.CapturedAt == incoming.CapturedAt,
                cancellationToken);

            if (already)
            {
                skipped++;
                continue;
            }

            db.RankSnapshots.Add(new RankSnapshot
            {
                RiotAccountId = accountId,
                QueueType = incoming.QueueType,
                Tier = incoming.Tier,
                Division = incoming.Division,
                LeaguePoints = incoming.LeaguePoints,
                Wins = incoming.Wins,
                Losses = incoming.Losses,

                // Recomputed rather than trusted. The source stored one too, and
                // the ladder maths has moved since some of those rows were
                // written — a stale position would plot a graph nothing else on
                // this server agrees with.
                LadderPosition = Ladder.LadderPosition(
                    new Rank(incoming.Tier, incoming.Division, incoming.LeaguePoints)),

                Source = incoming.Source,
                CapturedAt = incoming.CapturedAt,

                // Only a manual reading names a game, and only if that game came
                // across. A dangling id would survive the NO ACTION constraint
                // and then join to nothing.
                MatchId = incoming.Source == RankSources.Manual ? incoming.MatchId : null
            });

            accepted++;
        }

        // A manual reading naming a match that was never imported would fail the
        // foreign key for the whole batch, so those are cleared rather than
        // allowed to take the page down with them.
        await ClearDanglingMatchIdsAsync(db, cancellationToken);

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new ImportBatchResult(accepted, skipped, 0));
    }

    /// <summary>
    /// Merges the source's season boundaries into this server's.
    ///
    /// Merged rather than replaced, and matched on the instant a season opened
    /// rather than on its name: the boundary is the fact, and two people will
    /// have typed "Season 2026" and "2026" for the same one. A server that has
    /// been running a while already has boundaries somebody entered, and an
    /// import must not overwrite a correction with the copy that predates it.
    /// </summary>
    private static async Task<IResult> SeasonsAsync(
        [FromBody] IReadOnlyList<ImportSeason> seasons,
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        if (seasons is null || seasons.Count == 0) return Results.Ok(new ImportBatchResult(0, 0, 0));

        var existing = await db.Seasons.Select(s => s.StartsAt).ToListAsync(cancellationToken);
        var known = existing.ToHashSet();

        var accepted = 0;

        foreach (var incoming in seasons)
        {
            if (!known.Add(incoming.StartsAt)) continue;

            db.Seasons.Add(new RankedSeason
            {
                Label = incoming.Label,
                StartsAt = incoming.StartsAt,
                IsPreseason = incoming.IsPreseason,
                ResetsRank = incoming.ResetsRank
            });

            accepted++;
        }

        await db.SaveChangesAsync(cancellationToken);

        return Results.Ok(new ImportBatchResult(accepted, seasons.Count - accepted, 0));
    }

    /// <summary>
    /// Works out the LP for everything that just arrived.
    ///
    /// Attributed rows are not imported — they are derived from the readings,
    /// which are — so this is where a year of somebody's history gets its
    /// numbers back. Unbounded rather than the routine thirty days, since the
    /// whole point is to reach rows older than any window.
    /// </summary>
    private static async Task<IResult> FinishAsync(
        FoxfireDbContext db,
        AttributionRunner attribution,
        ILogger<Program> logger,
        CancellationToken cancellationToken)
    {
        var accounts = await db.RiotAccounts.AsNoTracking()
            .Select(a => new { a.Id, a.Puuid })
            .ToListAsync(cancellationToken);

        var attributed = 0;

        foreach (var account in accounts)
        {
            attributed += await attribution.ReplayAsync(account.Id, account.Puuid, null, cancellationToken);
        }

        logger.LogInformation(
            "Import finished: {Accounts} account(s), LP worked out for {Attributed} game(s)",
            accounts.Count,
            attributed);

        return Results.Ok(new ImportSummary(accounts.Count, attributed));
    }

    /// <summary>
    /// Every retired id and what it means now.
    ///
    /// Loaded per batch rather than held between them, so the import needs no
    /// session and no state beyond the rows it has already written — an import
    /// resumed after a failure or a restart picks up exactly where it was.
    /// </summary>
    private static async Task<IReadOnlyDictionary<string, string>> PuuidRewritesAsync(
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        var rows = await db.RetiredPuuids.AsNoTracking()
            .Join(
                db.RiotAccounts.AsNoTracking(),
                retired => retired.RiotAccountId,
                account => account.Id,
                (retired, account) => new { Old = retired.Puuid, New = account.Puuid })
            .ToListAsync(cancellationToken);

        Dictionary<string, string> rewrites = new(StringComparer.Ordinal);
        foreach (var row in rows) rewrites[row.Old] = row.New;

        return rewrites;
    }

    /// <summary>Which account each id the import might name belongs to, old and current.</summary>
    private static async Task<IReadOnlyDictionary<string, Guid>> OwnersByPuuidAsync(
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        Dictionary<string, Guid> owners = new(StringComparer.Ordinal);

        foreach (var account in await db.RiotAccounts.AsNoTracking()
                     .Select(a => new { a.Id, a.Puuid }).ToListAsync(cancellationToken))
        {
            owners[account.Puuid] = account.Id;
        }

        foreach (var retired in await db.RetiredPuuids.AsNoTracking()
                     .Select(r => new { r.RiotAccountId, r.Puuid }).ToListAsync(cancellationToken))
        {
            owners[retired.Puuid] = retired.RiotAccountId;
        }

        return owners;
    }

    /// <summary>
    /// Rewrites every known dead id in a payload to the one it means now.
    ///
    /// Textual, over the whole document, exactly as the key-rotation path
    /// rewrites a stored payload. An id appears in the metadata roster and once
    /// in a participant block, and both should become the new one.
    /// </summary>
    private static string Rewrite(string rawJson, IReadOnlyDictionary<string, string> rewrites)
    {
        if (rewrites.Count == 0) return rawJson;

        foreach (var (old, current) in rewrites)
        {
            if (rawJson.Contains(old, StringComparison.Ordinal))
            {
                rawJson = rawJson.Replace(old, current, StringComparison.Ordinal);
            }
        }

        return rawJson;
    }

    /// <summary>Drops the match link off any staged reading whose game is not here.</summary>
    private static async Task ClearDanglingMatchIdsAsync(
        FoxfireDbContext db,
        CancellationToken cancellationToken)
    {
        var staged = db.ChangeTracker.Entries<RankSnapshot>()
            .Where(e => e.State == EntityState.Added && e.Entity.MatchId is not null)
            .ToList();

        if (staged.Count == 0) return;

        var named = staged.Select(e => e.Entity.MatchId!).Distinct().ToList();

        var present = (await db.Matches.AsNoTracking()
                .Where(m => named.Contains(m.MatchId))
                .Select(m => m.MatchId)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        foreach (var entry in staged.Where(e => !present.Contains(e.Entity.MatchId!)))
        {
            entry.Entity.MatchId = null;
        }
    }

    private static IResult TooBig() =>
        AuthEndpoints.Problem(
            "batch_too_large",
            $"Send at most {MaxBatch} at a time — a page of matches is already megabytes.");
}
