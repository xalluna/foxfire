using System.Text.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Data;
using Foxfire.Riot;

namespace Foxfire.Api.Features.Import;

/// <summary>
/// One batch of TFT game payloads out of somebody's stats.db.
///
/// The same as <see cref="ImportMatchesRequest"/>, stored as TFT games: the
/// payloads are rewritten onto the ids this server files TFT under — the main
/// ones, or TFT's own key's when it has one — then ingested exactly as a sync
/// would ingest them.
/// </summary>
public sealed record ImportTftMatchesRequest(IReadOnlyList<ImportMatch> Matches)
    : IValidatedRequest<ImportBatchResult>, IImportBatch
{
    public int Count => Matches?.Count ?? 0;
}

internal sealed class ImportTftMatchesRequestValidator : ImportBatchValidator<ImportTftMatchesRequest>;

internal sealed class ImportTftMatchesRequestHandler(
    FoxfireDbContext db,
    MatchIngestion ingestion,
    TftMatchIngestion tftIngestion,
    TftRiot tft,
    ILogger<ImportTftMatchesRequestHandler> logger)
    : IValidatedRequestHandler<ImportTftMatchesRequest, ImportBatchResult>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<Response<ImportBatchResult>> Handle(
        ImportTftMatchesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (request.Count == 0) return new ImportBatchResult(0, 0, 0);

        var rewrites = await ImportTranslation.TftPuuidRewritesAsync(db, tft.HasOwnKey, cancellationToken);

        var ids = request.Matches.Select(m => m.MatchId).ToList();
        var unstored = (await ingestion.FilterUnstoredAsync(ids, cancellationToken)).ToHashSet(StringComparer.Ordinal);

        var accepted = 0;
        var failed = 0;

        foreach (var incoming in request.Matches)
        {
            if (!unstored.Contains(incoming.MatchId)) continue;

            try
            {
                var rawJson = ImportTranslation.Rewrite(incoming.RawJson, rewrites);
                var parsed = JsonSerializer.Deserialize<TftMatchDto>(rawJson, Json);

                if (parsed?.Metadata?.MatchId is null
                    || parsed.Info?.Participants is not { Count: > 0 } participants
                    || participants.Any(p => string.IsNullOrEmpty(p.Puuid) || p.Placement < 1))
                {
                    failed++;
                    continue;
                }

                if (await tftIngestion.StoreAsync(new RawTftMatch(parsed, rawJson), cancellationToken)) accepted++;
            }
            catch (JsonException)
            {
                failed++;
            }
        }

        if (failed > 0) logger.LogWarning("{Failed} imported TFT payload(s) could not be read", failed);

        return new ImportBatchResult(accepted, request.Count - accepted - failed, failed);
    }
}
