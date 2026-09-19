using System.Text.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Riot;

namespace Foxfire.Api.Features.Import;

/// <summary>One stored game, as the payload it already is.</summary>
public sealed record ImportMatch(string MatchId, string RawJson);

/// <summary>
/// Stores a page of matches out of their own payloads.
///
/// The payload is all that is needed: it is the same JSON Riot sends, and the
/// server already knows how to turn one of those into rows. What it is not is
/// addressed the same way — every id in it belongs to whoever's key fetched
/// it — so the retired ids recorded by the account batch are rewritten to the
/// current ones before anything is projected.
///
/// Strangers' ids are left dead, which is the same trade the key-rotation path
/// makes: nine of the ten players in a match are not members here, no lookup
/// goes through them, and re-resolving each would cost a Riot request per
/// player per match.
/// </summary>
public sealed record ImportMatchesRequest(IReadOnlyList<ImportMatch> Matches)
    : IValidatedRequest<ImportBatchResult>, IImportBatch
{
    public int Count => Matches?.Count ?? 0;
}

internal sealed class ImportMatchesRequestValidator : ImportBatchValidator<ImportMatchesRequest>;

internal sealed class ImportMatchesRequestHandler(
    FoxfireDbContext db,
    MatchIngestion ingestion,
    ILogger<ImportMatchesRequestHandler> logger)
    : IValidatedRequestHandler<ImportMatchesRequest, ImportBatchResult>
{
    public async Task<Response<ImportBatchResult>> Handle(
        ImportMatchesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.Count == 0) return new ImportBatchResult(0, 0, 0);

        var rewrites = await ImportTranslation.PuuidRewritesAsync(db, cancellationToken);

        var ids = request.Matches.Select(m => m.MatchId).ToList();
        var unstored = (await ingestion.FilterUnstoredAsync(ids, cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        var accepted = 0;
        var failed = 0;

        foreach (var incoming in request.Matches)
        {
            if (!unstored.Contains(incoming.MatchId)) continue;

            try
            {
                var rawJson = ImportTranslation.Rewrite(incoming.RawJson, rewrites);
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

        return new ImportBatchResult(accepted, request.Count - accepted - failed, failed);
    }
}
