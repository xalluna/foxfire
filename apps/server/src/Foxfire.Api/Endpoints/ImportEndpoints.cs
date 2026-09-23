using Foxfire.Api.Common;
using Foxfire.Api.Features.Import;
using Foxfire.Data.Entities;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace Foxfire.Api.Endpoints;

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
/// and are re-resolved from gameName#tagLine through account-v1 — which is
/// exactly what the server already does when its own key rotates. The imported
/// puuid is filed as a retired one against the account it resolved to, and that
/// record is what every later batch is translated through.
///
/// Three things deliberately do not come across. Accounts arrive unlinked,
/// because on a server that answer is attested by a running League client
/// rather than asserted by an import. No Foxfire accounts, because there were
/// none — a stats.db has no users, no passwords and no sessions. And no
/// attributed LP: it is derived from the readings, which do come across, so
/// importing it would import a stale copy of something this server works out
/// itself at the end.
///
/// A file can be imported again. Somebody keeps using Foxfire on their own PC for
/// a few more days and sends the newer copy: every batch skips what the server
/// already holds, so what lands is what is new. Two things make that cheap
/// rather than merely correct. An account whose id the server already has a
/// record for is not looked up again, and /unstored-matches lets a client ask
/// which games are worth sending before it sends any of their payloads.
///
/// Each batch arrives as a bare JSON array, which is why every route here wraps
/// its body in a request rather than binding one directly.
/// </summary>
public static class ImportEndpoints
{
    public static void MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/admin/import")
            .WithTags("Import")
            .RequireAuthorization(policy => policy.RequireRole(FoxfireRoles.Admin));

        group.MapPost("/accounts", (
                [FromBody] IReadOnlyList<ImportAccount> accounts,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ImportAccountsRequest(accounts), cancellationToken));

        group.MapPost("/unstored-matches", (
                [FromBody] IReadOnlyList<string> matchIds,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new UnstoredMatchesRequest(matchIds), cancellationToken));

        group.MapPost("/matches", (
                [FromBody] IReadOnlyList<ImportMatch> matches,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ImportMatchesRequest(matches), cancellationToken));

        group.MapPost("/rank-readings", (
                [FromBody] IReadOnlyList<ImportRankReading> readings,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ImportRankReadingsRequest(readings), cancellationToken));

        group.MapPost("/seasons", (
                [FromBody] IReadOnlyList<ImportSeason> seasons,
                ISender sender,
                CancellationToken cancellationToken) =>
            sender.SendAsync(new ImportSeasonsRequest(seasons), cancellationToken));

        group.MapPost("/finish", (ISender sender, CancellationToken cancellationToken) =>
            sender.SendAsync(new FinishImportRequest(), cancellationToken));
    }
}
