using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Import;

/// <summary>How much of a batch landed.</summary>
public sealed record ImportBatchResult(int Accepted, int Skipped, int Failed);

/// <summary>A batch of something, out of somebody's stats.db.</summary>
public interface IImportBatch
{
    int Count { get; }
}

/// <summary>
/// The cap every import batch shares.
///
/// Matches are 100–200 KB each, so a hundred of them is a 20 MB request: enough
/// that a year of history is a few dozen calls rather than thousands, and small
/// enough that a failure costs a page rather than the import.
/// </summary>
internal abstract class ImportBatchValidator<TRequest> : AbstractValidator<TRequest>
    where TRequest : IImportBatch
{
    public const int MaxBatch = 100;

    protected ImportBatchValidator() =>
        RuleFor(x => x.Count)
            .LessThanOrEqualTo(MaxBatch)
            .WithErrorCode("batch_too_large")
            .WithMessage($"Send at most {MaxBatch} at a time — a page of matches is already megabytes.");
}

/// <summary>
/// What every batch after the first has to be translated through.
///
/// Riot encrypts a player id against the API key that asked for it, and the key
/// that wrote the file being imported is not this server's — so every puuid in
/// it is a value Riot will refuse. The accounts batch goes first and files each
/// dead id as a retired one against the account it re-resolved to; this is how
/// the later batches read that record back.
///
/// Loaded per batch rather than held between them, so the import needs no
/// session and no state beyond the rows it has already written. An import
/// resumed after a failure or a restart picks up exactly where it was.
/// </summary>
internal static class ImportTranslation
{
    /// <summary>Every retired id and what it means now.</summary>
    public static async Task<IReadOnlyDictionary<string, string>> PuuidRewritesAsync(
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
    public static async Task<IReadOnlyDictionary<string, Guid>> OwnersByPuuidAsync(
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
    public static string Rewrite(string rawJson, IReadOnlyDictionary<string, string> rewrites)
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
}
